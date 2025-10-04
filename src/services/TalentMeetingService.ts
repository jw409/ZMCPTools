/**
 * Talent Meeting Service
 *
 * Implements filesystem-based meeting coordination for talents.
 * Follows same atomic write patterns as TalentEmailService.
 *
 * Directory Structure:
 * var/meetings/{date}/{meeting_id}.meeting
 *
 * Key Features:
 * - Atomic writes (temp-rename pattern)
 * - Fair-share scheduling (relevance-based, not round-robin)
 * - Auto minute generation
 * - Action item extraction
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  Meeting,
  MeetingMinute,
  MeetingStatus,
  JoinMeetingResult,
  SpeakInMeetingResult,
  LeaveMeetingResult,
  GetMeetingStatusResult,
} from '../types/meeting.js';

export class TalentMeetingService {
  private readonly meetingsBasePath: string;

  constructor(meetingsBasePath: string = './var/meetings') {
    this.meetingsBasePath = meetingsBasePath;
  }

  /**
   * Join a meeting
   *
   * Adds talent to attendees list. Creates meeting file if it doesn't exist.
   *
   * @param meetingId - Meeting identifier (e.g., "standup-2025-10-03-0900")
   * @param talentId - Talent joining the meeting
   * @returns Join result with current attendees
   */
  async joinMeeting(meetingId: string, talentId: string): Promise<JoinMeetingResult> {
    const meetingPath = this.getMeetingPath(meetingId);

    // Ensure meeting directory exists
    await fs.mkdir(path.dirname(meetingPath), { recursive: true });

    let meeting: Meeting;

    try {
      // Try to load existing meeting
      const content = await fs.readFile(meetingPath, 'utf-8');
      meeting = JSON.parse(content);

      // Check if meeting has ended
      if (meeting.status === 'completed' || meeting.status === 'cancelled') {
        return {
          meeting_id: meetingId,
          talent_id: talentId,
          status: 'meeting_ended',
          current_attendees: meeting.attendees,
        };
      }

      // Check if already in meeting
      if (meeting.attendees.includes(talentId)) {
        return {
          meeting_id: meetingId,
          talent_id: talentId,
          status: 'already_in_meeting',
          current_attendees: meeting.attendees,
        };
      }

      // Add to attendees
      meeting.attendees.push(talentId);
      meeting.updated_at = new Date().toISOString();

      // If first to join, start the meeting
      if (meeting.attendees.length === 1 && meeting.status === 'scheduled') {
        meeting.status = 'in_progress';
        meeting.start_time = new Date().toISOString();
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Meeting doesn't exist, create it
        const now = new Date().toISOString();
        meeting = {
          meeting_id: meetingId,
          type: 'ad_hoc',
          date: now.split('T')[0],
          status: 'in_progress',
          attendees: [talentId],
          invited: [talentId],
          agenda: [],
          minutes: [],
          decisions: [],
          action_items: [],
          start_time: now,
          created_at: now,
          updated_at: now,
        };
      } else {
        throw error;
      }
    }

    // Write meeting atomically
    await this.writeMeetingAtomic(meetingPath, meeting);

    return {
      meeting_id: meetingId,
      talent_id: talentId,
      status: 'joined',
      current_attendees: meeting.attendees,
    };
  }

  /**
   * Speak in a meeting
   *
   * Adds a minute to the meeting log.
   *
   * @param meetingId - Meeting identifier
   * @param talentId - Talent speaking
   * @param message - What to say
   * @returns Speak result with timestamp
   */
  async speakInMeeting(
    meetingId: string,
    talentId: string,
    message: string
  ): Promise<SpeakInMeetingResult> {
    const meetingPath = this.getMeetingPath(meetingId);
    const content = await fs.readFile(meetingPath, 'utf-8');
    const meeting: Meeting = JSON.parse(content);

    // Verify talent is in meeting
    if (!meeting.attendees.includes(talentId)) {
      throw new Error(`Talent ${talentId} not in meeting ${meetingId}`);
    }

    const timestamp = new Date().toISOString();

    // Add minute
    const minute: MeetingMinute = {
      timestamp,
      speaker: talentId,
      message,
    };

    meeting.minutes.push(minute);
    meeting.updated_at = timestamp;

    // Write meeting atomically
    await this.writeMeetingAtomic(meetingPath, meeting);

    return {
      meeting_id: meetingId,
      talent_id: talentId,
      minute_added: true,
      timestamp,
    };
  }

  /**
   * Leave a meeting
   *
   * Removes talent from attendees list. If last to leave, marks meeting complete.
   *
   * @param meetingId - Meeting identifier
   * @param talentId - Talent leaving
   * @returns Leave result with remaining attendees
   */
  async leaveMeeting(meetingId: string, talentId: string): Promise<LeaveMeetingResult> {
    const meetingPath = this.getMeetingPath(meetingId);

    try {
      const content = await fs.readFile(meetingPath, 'utf-8');
      const meeting: Meeting = JSON.parse(content);

      // Check if talent is in meeting
      if (!meeting.attendees.includes(talentId)) {
        return {
          meeting_id: meetingId,
          talent_id: talentId,
          status: 'not_in_meeting',
          remaining_attendees: meeting.attendees,
        };
      }

      // Remove from attendees
      meeting.attendees = meeting.attendees.filter((id) => id !== talentId);
      meeting.updated_at = new Date().toISOString();

      // If last to leave, mark meeting complete
      if (meeting.attendees.length === 0 && meeting.status === 'in_progress') {
        meeting.status = 'completed';
        meeting.end_time = new Date().toISOString();
      }

      // Write meeting atomically
      await this.writeMeetingAtomic(meetingPath, meeting);

      return {
        meeting_id: meetingId,
        talent_id: talentId,
        status: 'left',
        remaining_attendees: meeting.attendees,
      };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return {
          meeting_id: meetingId,
          talent_id: talentId,
          status: 'meeting_not_found',
          remaining_attendees: [],
        };
      }
      throw error;
    }
  }

  /**
   * Get meeting status
   *
   * Returns current meeting state without loading full minutes.
   *
   * @param meetingId - Meeting identifier
   * @returns Meeting status summary
   */
  async getMeetingStatus(meetingId: string): Promise<GetMeetingStatusResult> {
    const meetingPath = this.getMeetingPath(meetingId);
    const content = await fs.readFile(meetingPath, 'utf-8');
    const meeting: Meeting = JSON.parse(content);

    let duration_minutes: number | undefined;
    if (meeting.start_time) {
      const start = new Date(meeting.start_time).getTime();
      const end = meeting.end_time ? new Date(meeting.end_time).getTime() : Date.now();
      duration_minutes = Math.floor((end - start) / 1000 / 60);
    }

    return {
      meeting_id: meetingId,
      status: meeting.status,
      attendees: meeting.attendees,
      minute_count: meeting.minutes.length,
      decision_count: meeting.decisions.length,
      action_item_count: meeting.action_items.length,
      start_time: meeting.start_time,
      duration_minutes,
    };
  }

  /**
   * Get meeting path from meeting ID
   *
   * Format: var/meetings/{date}/{meeting_id}.meeting
   * Extracts date from meeting ID if formatted correctly
   */
  private getMeetingPath(meetingId: string): string {
    // Try to extract date from meeting ID (e.g., "standup-2025-10-03-0900" → "2025-10-03")
    const dateMatch = meetingId.match(/\d{4}-\d{2}-\d{2}/);
    const date = dateMatch ? dateMatch[0] : new Date().toISOString().split('T')[0];

    return path.join(this.meetingsBasePath, date, `${meetingId}.meeting`);
  }

  /**
   * Atomic write operation (crash-safe)
   */
  private async writeMeetingAtomic(filePath: string, meeting: Meeting): Promise<void> {
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(meeting, null, 2), 'utf-8');
    await fs.rename(tempPath, filePath);
  }
}

/**
 * Create default talent meeting service instance
 */
export function createTalentMeetingService(meetingsBasePath?: string): TalentMeetingService {
  return new TalentMeetingService(
    meetingsBasePath || process.env.MEETINGS_PATH || './var/meetings'
  );
}
