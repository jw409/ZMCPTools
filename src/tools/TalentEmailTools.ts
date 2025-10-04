/**
 * Talent Email MCP Tools
 *
 * Provides MCP tools for filesystem-based inter-talent email communication.
 * This is NOT real email - it's an internal messaging system using email metaphors.
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { TalentEmailService } from '../services/TalentEmailService.js';
import type { EmailPriority } from '../types/email.js';

// Zod schemas for validation
const EmailPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);

const SendEmailSchema = z.object({
  from: z.string().describe('Sender talent ID (e.g., "backend-boris-001")'),
  to: z.array(z.string()).describe('Array of recipient talent IDs'),
  cc: z.array(z.string()).optional().default([]).describe('Carbon copy recipient talent IDs'),
  subject: z.string().describe('Email subject (reflects sender personality)'),
  body: z.string().describe('Email body content (plain text, markdown supported)'),
  priority: EmailPrioritySchema.optional().default('normal').describe('Email priority level'),
  thread_id: z.string().nullable().optional().describe('Thread ID for conversation grouping'),
  in_reply_to: z.string().nullable().optional().describe('Reference to parent email'),
  attachments: z.array(z.object({
    filename: z.string(),
    path: z.string(),
    mime_type: z.string(),
  })).optional().default([]).describe('File attachments'),
});

const CheckInboxSchema = z.object({
  talent_id: z.string().describe('Talent ID whose inbox to check'),
  limit: z.number().optional().default(10).describe('Maximum emails to return'),
  unread_only: z.boolean().optional().default(true).describe('Only return unread emails'),
});

const ProcessEmailSchema = z.object({
  talent_id: z.string().describe('Talent ID whose email to process'),
  email_filename: z.string().describe('Filename of the email to archive (e.g., "20251003T120000Z-backend-boris-001-task-refusal.email")'),
});

const GetEmailSchema = z.object({
  talent_id: z.string().describe('Talent ID whose email to read'),
  email_filename: z.string().describe('Filename of the email to read'),
});

const EnsureCoordinationDirsSchema = z.object({
  talent_id: z.string().describe('Talent ID to create coordination directories for'),
});

export class TalentEmailTools {
  private emailService: TalentEmailService;

  constructor(coordinationBasePath?: string, talentsBasePath?: string) {
    this.emailService = new TalentEmailService(coordinationBasePath, talentsBasePath);
  }

  /**
   * Get all MCP tools for talent email system
   */
  getTools(): any[] {
    return [
      {
        name: 'send_email',
        description: 'Send an email from one talent to others. This is NOT real email - it\'s an internal messaging system for inter-talent coordination within the filesystem. Creates .email files in each recipient\'s inbox/ directory.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Sender talent ID (e.g., "backend-boris-001")' },
            to: { type: 'array', items: { type: 'string' }, description: 'Array of recipient talent IDs' },
            cc: { type: 'array', items: { type: 'string' }, description: 'Carbon copy recipient talent IDs (optional)' },
            subject: { type: 'string', description: 'Email subject (should reflect sender personality)' },
            body: { type: 'string', description: 'Email body content (plain text, markdown supported)' },
            priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], description: 'Email priority level (default: normal)' },
            thread_id: { type: 'string', description: 'Thread ID for conversation grouping (optional)' },
            in_reply_to: { type: 'string', description: 'Reference to parent email (optional)' },
            attachments: { type: 'array', items: { type: 'object' }, description: 'File attachments (optional)' },
          },
          required: ['from', 'to', 'subject', 'body'],
        },
        handler: this.sendEmailHandler.bind(this),
      },
      {
        name: 'check_inbox',
        description: 'Check a talent\'s inbox for emails. Returns email metadata without loading full bodies for efficiency. Use this to poll for new messages.',
        inputSchema: {
          type: 'object',
          properties: {
            talent_id: { type: 'string', description: 'Talent ID whose inbox to check' },
            limit: { type: 'number', description: 'Maximum emails to return (default: 10)' },
            unread_only: { type: 'boolean', description: 'Only return unread emails (default: true)' },
          },
          required: ['talent_id'],
        },
        handler: this.checkInboxHandler.bind(this),
      },
      {
        name: 'process_email',
        description: 'Process (archive) an email by moving it from inbox/ to processed/. Marks the email as read. Use after reading and handling an email.',
        inputSchema: {
          type: 'object',
          properties: {
            talent_id: { type: 'string', description: 'Talent ID whose email to process' },
            email_filename: { type: 'string', description: 'Filename of the email to archive' },
          },
          required: ['talent_id', 'email_filename'],
        },
        handler: this.processEmailHandler.bind(this),
      },
      {
        name: 'get_email',
        description: 'Get the full content of a specific email. Use this to read the complete email body after seeing it in the inbox listing.',
        inputSchema: {
          type: 'object',
          properties: {
            talent_id: { type: 'string', description: 'Talent ID whose email to read' },
            email_filename: { type: 'string', description: 'Filename of the email to read' },
          },
          required: ['talent_id', 'email_filename'],
        },
        handler: this.getEmailHandler.bind(this),
      },
      {
        name: 'ensure_coordination_directories',
        description: 'Ensure inbox/ and processed/ directories exist for a talent. Use this during talent setup or initialization.',
        inputSchema: {
          type: 'object',
          properties: {
            talent_id: { type: 'string', description: 'Talent ID to create coordination directories for' },
          },
          required: ['talent_id'],
        },
        handler: this.ensureCoordinationDirsHandler.bind(this),
      },
    ];
  }

  /**
   * Handler for send_email tool
   */
  async sendEmailHandler(args: any): Promise<any> {
    const params = SendEmailSchema.parse(args);
    const result = await this.emailService.sendEmail(params);
    return result;
  }

  /**
   * Handler for check_inbox tool
   */
  async checkInboxHandler(args: any): Promise<any> {
    const params = CheckInboxSchema.parse(args);
    const result = await this.emailService.checkInbox(
      params.talent_id,
      params.limit,
      params.unread_only
    );
    return result;
  }

  /**
   * Handler for process_email tool
   */
  async processEmailHandler(args: any): Promise<any> {
    const params = ProcessEmailSchema.parse(args);
    const result = await this.emailService.processEmail(
      params.talent_id,
      params.email_filename
    );
    return result;
  }

  /**
   * Handler for get_email tool
   */
  async getEmailHandler(args: any): Promise<any> {
    const params = GetEmailSchema.parse(args);
    const result = await this.emailService.getEmail(params.talent_id, params.email_filename);
    return result;
  }

  /**
   * Handler for ensure_coordination_directories tool
   */
  async ensureCoordinationDirsHandler(args: any): Promise<any> {
    const params = EnsureCoordinationDirsSchema.parse(args);
    await this.emailService.ensureCoordinationDirectories(params.talent_id);
    return {
      success: true,
      message: `Coordination directories created for ${params.talent_id}`,
    };
  }
}
