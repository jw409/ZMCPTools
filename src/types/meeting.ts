/**
 * TalentOS Meeting System Type Definitions
 *
 * Implements Issue #29: Meeting simulation for talent coordination
 *
 * Design Philosophy:
 * - Atomic .meeting files (NOT monolithic meetings.json)
 * - Fair-share scheduling (relevance-based, not round-robin)
 * - Meeting types: standup, planning, architecture_review, retrospective
 * - Automatic minute generation and action item extraction
 *
 * Directory Structure:
 * var/meetings/{date}/{meeting_id}.meeting
 * Example: var/meetings/2025-10-03/standup-0900.meeting
 */

export type MeetingType = 'standup' | 'planning' | 'architecture_review' | 'retrospective' | 'ad_hoc';

export type MeetingStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

/**
 * Meeting Minute Entry
 */
export interface MeetingMinute {
  timestamp: string;                 // ISO 8601
  speaker: string;                   // talent_id
  message: string;                   // What was said
  message_type?: 'update' | 'blocker' | 'decision' | 'question' | 'action_item';
}

/**
 * Meeting Decision
 */
export interface MeetingDecision {
  decision: string;
  decided_by: string[];              // talent_ids who agreed
  timestamp: string;
}

/**
 * Action Item from Meeting
 */
export interface MeetingActionItem {
  action: string;
  assigned_to: string;               // talent_id
  due_date?: string;                 // ISO 8601
  status: 'pending' | 'in_progress' | 'completed';
  created_at: string;
}

/**
 * Meeting Data Structure
 *
 * Stored as JSON in var/meetings/{date}/{meeting_id}.meeting
 */
export interface Meeting {
  meeting_id: string;                // "standup-2025-10-03-0900"
  type: MeetingType;
  date: string;                      // "2025-10-03"
  status: MeetingStatus;

  // Participants
  attendees: string[];               // talent_ids currently in meeting
  chair?: string;                    // talent_id of meeting chair
  invited: string[];                 // All invited talent_ids

  // Agenda and content
  agenda: string[];
  minutes: MeetingMinute[];
  decisions: MeetingDecision[];
  action_items: MeetingActionItem[];

  // Metadata
  start_time?: string;               // ISO 8601
  end_time?: string;                 // ISO 8601
  created_at: string;
  updated_at: string;
}

/**
 * Join Meeting Result
 */
export interface JoinMeetingResult {
  meeting_id: string;
  talent_id: string;
  status: 'joined' | 'already_in_meeting' | 'meeting_not_found' | 'meeting_ended';
  current_attendees: string[];
}

/**
 * Speak in Meeting Result
 */
export interface SpeakInMeetingResult {
  meeting_id: string;
  talent_id: string;
  minute_added: boolean;
  timestamp: string;
}

/**
 * Leave Meeting Result
 */
export interface LeaveMeetingResult {
  meeting_id: string;
  talent_id: string;
  status: 'left' | 'not_in_meeting' | 'meeting_not_found';
  remaining_attendees: string[];
}

/**
 * Get Meeting Status Result
 */
export interface GetMeetingStatusResult {
  meeting_id: string;
  status: MeetingStatus;
  attendees: string[];
  minute_count: number;
  decision_count: number;
  action_item_count: number;
  start_time?: string;
  duration_minutes?: number;
}
