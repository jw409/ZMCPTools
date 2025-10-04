/**
 * Talent Meeting MCP Tools
 *
 * Provides MCP tools for filesystem-based meeting coordination.
 * Used by TalentMcpServer (domU) only - NOT global server.
 */

import { z } from 'zod';
import { TalentMeetingService } from '../services/TalentMeetingService.js';

// Zod schemas for validation
const JoinMeetingSchema = z.object({
  meeting_id: z.string().describe('Meeting ID (e.g., "standup-2025-10-03-0900")'),
  talent_id: z.string().describe('Talent ID joining the meeting'),
});

const SpeakInMeetingSchema = z.object({
  meeting_id: z.string().describe('Meeting ID'),
  talent_id: z.string().describe('Talent ID speaking'),
  message: z.string().describe('What to say in the meeting'),
});

const LeaveMeetingSchema = z.object({
  meeting_id: z.string().describe('Meeting ID'),
  talent_id: z.string().describe('Talent ID leaving'),
});

const GetMeetingStatusSchema = z.object({
  meeting_id: z.string().describe('Meeting ID'),
});

export class TalentMeetingTools {
  private meetingService: TalentMeetingService;

  constructor(meetingsBasePath?: string) {
    this.meetingService = new TalentMeetingService(meetingsBasePath);
  }

  /**
   * Get all MCP tools for talent meeting system
   */
  getTools(): any[] {
    return [
      {
        name: 'join_meeting',
        description: 'Join a meeting as a talent. Creates meeting if it doesn\'t exist. Used for talent coordination and collaboration.',
        inputSchema: {
          type: 'object',
          properties: {
            meeting_id: { type: 'string', description: 'Meeting ID (e.g., "standup-2025-10-03-0900")' },
            talent_id: { type: 'string', description: 'Talent ID joining the meeting' },
          },
          required: ['meeting_id', 'talent_id'],
        },
        handler: this.joinMeetingHandler.bind(this),
      },
      {
        name: 'speak_in_meeting',
        description: 'Speak in a meeting (add a minute). Talent must have joined the meeting first. Messages are logged with timestamp.',
        inputSchema: {
          type: 'object',
          properties: {
            meeting_id: { type: 'string', description: 'Meeting ID' },
            talent_id: { type: 'string', description: 'Talent ID speaking' },
            message: { type: 'string', description: 'What to say in the meeting' },
          },
          required: ['meeting_id', 'talent_id', 'message'],
        },
        handler: this.speakInMeetingHandler.bind(this),
      },
      {
        name: 'leave_meeting',
        description: 'Leave a meeting. If last attendee, meeting is marked complete. Use when done participating.',
        inputSchema: {
          type: 'object',
          properties: {
            meeting_id: { type: 'string', description: 'Meeting ID' },
            talent_id: { type: 'string', description: 'Talent ID leaving' },
          },
          required: ['meeting_id', 'talent_id'],
        },
        handler: this.leaveMeetingHandler.bind(this),
      },
      {
        name: 'get_meeting_status',
        description: 'Get meeting status summary (attendees, minute count, duration). Lightweight check without loading full minutes.',
        inputSchema: {
          type: 'object',
          properties: {
            meeting_id: { type: 'string', description: 'Meeting ID' },
          },
          required: ['meeting_id'],
        },
        handler: this.getMeetingStatusHandler.bind(this),
      },
    ];
  }

  /**
   * Handler for join_meeting tool
   */
  async joinMeetingHandler(args: any): Promise<any> {
    const params = JoinMeetingSchema.parse(args);
    const result = await this.meetingService.joinMeeting(params.meeting_id, params.talent_id);
    return result;
  }

  /**
   * Handler for speak_in_meeting tool
   */
  async speakInMeetingHandler(args: any): Promise<any> {
    const params = SpeakInMeetingSchema.parse(args);
    const result = await this.meetingService.speakInMeeting(
      params.meeting_id,
      params.talent_id,
      params.message
    );
    return result;
  }

  /**
   * Handler for leave_meeting tool
   */
  async leaveMeetingHandler(args: any): Promise<any> {
    const params = LeaveMeetingSchema.parse(args);
    const result = await this.meetingService.leaveMeeting(params.meeting_id, params.talent_id);
    return result;
  }

  /**
   * Handler for get_meeting_status tool
   */
  async getMeetingStatusHandler(args: any): Promise<any> {
    const params = GetMeetingStatusSchema.parse(args);
    const result = await this.meetingService.getMeetingStatus(params.meeting_id);
    return result;
  }
}
