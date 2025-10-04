/**
 * Talent Email Service
 *
 * Implements filesystem-based email communication for inter-talent coordination.
 * This is NOT real email - it's an internal messaging system using email metaphors.
 * All communication stays within the filesystem at var/coordination/{talent-id}/.
 *
 * Design Principles:
 * - Individual .email files (NOT monolithic emails.json) for token efficiency
 * - Atomic writes (temp-rename pattern) for crash consistency
 * - Email content reflects talent personalities
 * - Async coordination via filesystem (no real-time message bus overhead)
 *
 * Directory Structure:
 * var/coordination/{talent-id}/
 * ├── inbox/         # Unread emails
 * └── processed/     # Archived emails
 *
 * Filename Pattern: {timestamp}-{sender}-{subject}.email
 * Example: 20251003T120000Z-backend-boris-001-task-refusal.email
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
  EmailMessage,
  EmailSendResult,
  InboxResult,
  EmailFile,
  EmailProcessingResult,
  EmailPriority,
} from '../types/email.js';
import { TalentProfileService } from './TalentProfileService.js';

export class TalentEmailService {
  private readonly coordinationBasePath: string;
  private readonly talentService: TalentProfileService;

  constructor(coordinationBasePath: string = './var/coordination', talentsBasePath?: string) {
    this.coordinationBasePath = coordinationBasePath;
    this.talentService = new TalentProfileService(talentsBasePath);
  }

  /**
   * Send an email from one talent to others
   *
   * Creates individual .email files in each recipient's inbox/ directory.
   * Uses atomic writes for crash safety. Supports partial delivery
   * (some recipients succeed, others fail).
   *
   * @param emailData - Email message data
   * @returns Send result with delivery status
   */
  async sendEmail(emailData: Omit<EmailMessage, 'timestamp'>): Promise<EmailSendResult> {
    // Validate sender exists
    await this.talentService.getTalentCard(emailData.from);

    // Add timestamp
    const email: EmailMessage = {
      ...emailData,
      timestamp: new Date().toISOString(),
      thread_id: emailData.thread_id || null,
      in_reply_to: emailData.in_reply_to || null,
      attachments: emailData.attachments || [],
      cc: emailData.cc || [],
    };

    // Validate all recipients exist
    const allRecipients = [...email.to, ...email.cc];
    await this.validateTalents(allRecipients);

    // Generate email ID
    const email_id = randomUUID();

    // Attempt delivery to all recipients
    const delivered: string[] = [];
    const failed: string[] = [];
    const error_messages: Record<string, string> = {};

    for (const recipient of email.to) {
      try {
        await this.deliverToInbox(recipient, email, email_id);
        delivered.push(recipient);
      } catch (error: any) {
        console.error(`Failed to deliver to ${recipient}:`, error);
        failed.push(recipient);
        error_messages[recipient] = error.message || 'Unknown error';
      }
    }

    // Deliver to CC recipients (best effort, don't fail send if CC fails)
    for (const ccRecipient of email.cc) {
      try {
        await this.deliverToInbox(ccRecipient, email, email_id);
        if (!delivered.includes(ccRecipient)) {
          delivered.push(ccRecipient);
        }
      } catch (error: any) {
        console.error(`Failed to deliver CC to ${ccRecipient}:`, error);
        // Don't add to failed list for CC recipients
      }
    }

    // Determine overall status
    let status: 'sent' | 'partial' | 'failed';
    if (failed.length === 0) {
      status = 'sent';
    } else if (delivered.length > 0) {
      status = 'partial';
    } else {
      status = 'failed';
    }

    return {
      email_id,
      delivered_to: delivered,
      failed_to: failed,
      status,
      error_messages: Object.keys(error_messages).length > 0 ? error_messages : undefined,
    };
  }

  /**
   * Check a talent's inbox
   *
   * Returns email metadata without loading full bodies.
   * Efficient for inbox listing and polling.
   *
   * @param talentId - Talent whose inbox to check
   * @param limit - Maximum emails to return (default 10)
   * @param unread_only - Only return unread emails (default true)
   * @returns Inbox result with email metadata
   */
  async checkInbox(
    talentId: string,
    limit: number = 10,
    unread_only: boolean = true
  ): Promise<InboxResult> {
    // Validate talent exists
    await this.talentService.getTalentCard(talentId);

    const inboxPath = path.join(this.coordinationBasePath, talentId, 'inbox');
    const processedPath = path.join(this.coordinationBasePath, talentId, 'processed');

    // Ensure directories exist
    await fs.mkdir(inboxPath, { recursive: true });
    await fs.mkdir(processedPath, { recursive: true });

    // Read inbox emails
    const inboxFiles = await this.readEmailDirectory(inboxPath, false);

    // Read processed emails if needed
    const processedFiles = unread_only
      ? []
      : await this.readEmailDirectory(processedPath, true);

    // Combine and sort by timestamp (newest first)
    const allEmails = [...inboxFiles, ...processedFiles].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Apply limit
    const emails = allEmails.slice(0, limit);

    return {
      emails,
      unread_count: inboxFiles.length,
      total_count: inboxFiles.length + processedFiles.length,
    };
  }

  /**
   * Process (archive) an email
   *
   * Moves email from inbox/ to processed/ atomically.
   * Marks the email as read.
   *
   * @param talentId - Talent whose email to process
   * @param emailFilename - Filename of the email to process
   * @returns Processing result
   */
  async processEmail(talentId: string, emailFilename: string): Promise<EmailProcessingResult> {
    // Validate talent exists
    await this.talentService.getTalentCard(talentId);

    const inboxPath = path.join(this.coordinationBasePath, talentId, 'inbox', emailFilename);
    const processedPath = path.join(
      this.coordinationBasePath,
      talentId,
      'processed',
      emailFilename
    );

    // Check if email exists in inbox
    try {
      await fs.access(inboxPath);
    } catch (error: any) {
      // Maybe already processed?
      try {
        await fs.access(processedPath);
        return {
          email_id: this.extractEmailIdFromFilename(emailFilename),
          status: 'already_processed',
          processed_path: processedPath,
        };
      } catch {
        return {
          email_id: this.extractEmailIdFromFilename(emailFilename),
          status: 'not_found',
          processed_path: null,
        };
      }
    }

    // Ensure processed directory exists
    await fs.mkdir(path.dirname(processedPath), { recursive: true });

    // Atomic move from inbox to processed
    await fs.rename(inboxPath, processedPath);

    return {
      email_id: this.extractEmailIdFromFilename(emailFilename),
      status: 'processed',
      processed_path: processedPath,
    };
  }

  /**
   * Get full email content
   *
   * Loads the complete email message from disk.
   *
   * @param talentId - Talent whose email to read
   * @param emailFilename - Filename of the email
   * @returns Full email message
   */
  async getEmail(talentId: string, emailFilename: string): Promise<EmailMessage> {
    // Validate talent exists
    await this.talentService.getTalentCard(talentId);

    // Try inbox first, then processed
    const inboxPath = path.join(this.coordinationBasePath, talentId, 'inbox', emailFilename);
    const processedPath = path.join(
      this.coordinationBasePath,
      talentId,
      'processed',
      emailFilename
    );

    let content: string;
    try {
      content = await fs.readFile(inboxPath, 'utf-8');
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        content = await fs.readFile(processedPath, 'utf-8');
      } else {
        throw error;
      }
    }

    return JSON.parse(content) as EmailMessage;
  }

  /**
   * Ensure coordination directories exist for a talent
   *
   * Creates inbox/ and processed/ directories if they don't exist.
   *
   * @param talentId - Talent ID
   */
  async ensureCoordinationDirectories(talentId: string): Promise<void> {
    const talentCoordDir = path.join(this.coordinationBasePath, talentId);
    await fs.mkdir(path.join(talentCoordDir, 'inbox'), { recursive: true });
    await fs.mkdir(path.join(talentCoordDir, 'processed'), { recursive: true });
  }

  /**
   * Validate that all talent IDs exist
   */
  private async validateTalents(talentIds: string[]): Promise<void> {
    for (const id of talentIds) {
      await this.talentService.getTalentCard(id); // Throws if not found
    }
  }

  /**
   * Deliver email to a single recipient's inbox
   */
  private async deliverToInbox(
    recipientId: string,
    email: EmailMessage,
    emailId: string
  ): Promise<void> {
    const inboxDir = path.join(this.coordinationBasePath, recipientId, 'inbox');
    await fs.mkdir(inboxDir, { recursive: true });

    const filename = this.generateEmailFilename(email);
    const filePath = path.join(inboxDir, filename);

    // Write email atomically
    await this.writeFileAtomic(filePath, JSON.stringify(email, null, 2));
  }

  /**
   * Generate email filename from message
   *
   * Pattern: {timestamp}-{sender}-{subject}.email
   * Example: 20251003T120000Z-backend-boris-001-task-refusal.email
   */
  private generateEmailFilename(email: EmailMessage): string {
    // Format timestamp for filename (remove : and -)
    const timestamp = email.timestamp.replace(/[:.]/g, '').replace(/-/g, '').split('Z')[0] + 'Z';

    // Sanitize subject for filename
    const subject = email.subject
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);

    return `${timestamp}-${email.from}-${subject}.email`;
  }

  /**
   * Extract email ID from filename
   */
  private extractEmailIdFromFilename(filename: string): string {
    // For now, use filename as ID (could enhance with UUID in metadata)
    return filename.replace('.email', '');
  }

  /**
   * Read all emails from a directory
   */
  private async readEmailDirectory(dirPath: string, isRead: boolean): Promise<EmailFile[]> {
    try {
      const files = await fs.readdir(dirPath);
      const emailFiles = files.filter(f => f.endsWith('.email'));

      const emails = await Promise.all(
        emailFiles.map(async filename => {
          try {
            const filePath = path.join(dirPath, filename);
            const content = await fs.readFile(filePath, 'utf-8');
            const email = JSON.parse(content) as EmailMessage;

            return {
              email_id: this.extractEmailIdFromFilename(filename),
              filename,
              from: email.from,
              subject: email.subject,
              priority: email.priority,
              timestamp: email.timestamp,
              is_read: isRead,
              file_path: filePath,
            };
          } catch (error) {
            console.error(`Failed to read email ${filename}:`, error);
            return null;
          }
        })
      );

      return emails.filter((e): e is EmailFile => e !== null);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Atomic write operation (crash-safe)
   */
  private async writeFileAtomic(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, filePath);
  }
}

/**
 * Create default talent email service instance
 */
export function createTalentEmailService(
  coordinationBasePath?: string,
  talentsBasePath?: string
): TalentEmailService {
  return new TalentEmailService(
    coordinationBasePath || process.env.COORDINATION_PATH || './var/coordination',
    talentsBasePath
  );
}
