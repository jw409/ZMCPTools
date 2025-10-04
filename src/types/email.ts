/**
 * TalentOS Email System Type Definitions
 *
 * Implements Issue #28: Filesystem-based email communication for inter-talent coordination.
 *
 * IMPORTANT: This is NOT real email - it's an internal messaging system using email metaphors.
 * All communication stays within the filesystem at var/coordination/{talent-id}/.
 * No internet connectivity, no SMTP, no real email addresses - just talent IDs.
 *
 * Design Philosophy:
 * - Individual .email files (NOT monolithic emails.json) for token efficiency
 * - Atomic writes (temp-rename pattern) for crash consistency
 * - Email content reflects talent personalities (Boris's security focus, Felix's UX emphasis)
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

/**
 * Email Priority Levels
 *
 * Used for inbox sorting and urgency indication
 */
export type EmailPriority = "low" | "normal" | "high" | "urgent";

/**
 * Email Delivery Status
 *
 * Indicates the delivery result of an email send operation
 */
export type EmailDeliveryStatus = "sent" | "partial" | "failed";

/**
 * Email Message Structure
 *
 * Core email data structure stored as JSON in .email files.
 * Uses talent IDs (NOT email addresses) - purely internal messaging.
 */
export interface EmailMessage {
  // Talent-based addressing (NOT internet email addresses)
  from: string;                       // talent_id of sender (e.g., "backend-boris-001")
  to: string[];                       // Array of recipient talent_ids
  cc: string[];                       // Carbon copy recipients (talent_ids)
  subject: string;                    // Human-readable subject (reflects sender personality)
  body: string;                       // Email content (plain text, markdown supported)

  // Metadata
  priority: EmailPriority;
  timestamp: string;                  // ISO 8601 format

  // Threading (for future conversation tracking)
  thread_id: string | null;           // Group related emails
  in_reply_to: string | null;         // Reference to parent email

  // Attachments (for future file sharing)
  attachments: Array<{
    filename: string;
    path: string;                     // Relative path in coordination directory
    mime_type: string;
  }>;
}

/**
 * Email Send Result
 *
 * Returned by send_email() MCP tool to indicate delivery status.
 * Supports partial delivery (some recipients succeed, others fail).
 */
export interface EmailSendResult {
  email_id: string;                   // Unique identifier for tracking
  delivered_to: string[];             // Successfully delivered talent_ids
  failed_to: string[];                // Failed delivery talent_ids
  status: EmailDeliveryStatus;        // Overall status
  error_messages?: Record<string, string>; // talent_id → error message mapping
}

/**
 * Inbox Result
 *
 * Returned by check_inbox() MCP tool.
 * Includes email metadata for inbox listing without loading full bodies.
 */
export interface InboxResult {
  emails: EmailFile[];                // Array of email metadata
  unread_count: number;               // Number of emails in inbox/
  total_count: number;                // Total emails (inbox + processed)
}

/**
 * Email File Metadata
 *
 * Lightweight representation of an email for inbox listing.
 * Avoids loading full email bodies for performance.
 */
export interface EmailFile {
  email_id: string;                   // Unique identifier
  filename: string;                   // {timestamp}-{sender}-{subject}.email
  from: string;                       // Sender talent_id
  subject: string;                    // Email subject
  priority: EmailPriority;
  timestamp: string;                  // ISO 8601
  is_read: boolean;                   // True if in processed/, false if in inbox/
  file_path: string;                  // Full path to .email file
}

/**
 * Email Processing Result
 *
 * Returned by process_email() MCP tool.
 * Indicates successful archival from inbox/ to processed/.
 */
export interface EmailProcessingResult {
  email_id: string;
  status: "processed" | "already_processed" | "not_found";
  processed_path: string | null;      // Path in processed/ directory
}

/**
 * Email Search Query
 *
 * For future implementation of email search functionality.
 * Supports filtering by sender, subject, date range, priority.
 */
export interface EmailSearchQuery {
  talent_id: string;                  // Whose inbox to search
  sender?: string;                    // Filter by sender talent_id
  subject_contains?: string;          // Substring search in subject
  date_from?: string;                 // ISO 8601 date
  date_to?: string;
  priority?: EmailPriority;
  include_processed?: boolean;        // Search processed/ as well
  limit?: number;                     // Max results (default 50)
}

/**
 * Email Thread
 *
 * For future implementation of threaded conversations.
 * Groups related emails by thread_id.
 */
export interface EmailThread {
  thread_id: string;
  participants: string[];             // All talent_ids involved
  subject: string;                    // Thread subject
  message_count: number;
  latest_timestamp: string;           // ISO 8601
  emails: EmailMessage[];             // Chronologically sorted
}
