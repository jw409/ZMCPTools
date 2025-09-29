import { DatabaseManager } from '../database/index.js';
import { CommunicationRepository } from '../repositories/CommunicationRepository.js';
import { PathUtils } from '../utils/pathUtils.js';
import { eventBus } from './EventBus.js';
import { FairShareScheduler } from './FairShareScheduler.js';
import type { ChatRoom, ChatMessage, NewChatRoom, NewChatMessage, MessageType, MessageFilter, SendMessageRequest } from '../schemas/index.js';

export interface CreateRoomRequest {
  name: string;
  description: string;
  isGeneral?: boolean; // Optional, defaults to false
  repositoryPath: string;
  metadata?: Record<string, any>;
}

// SendMessageRequest is now imported from schemas

export interface CommunicationServiceMessageFilter {
  roomName?: string;
  agentName?: string;
  mentions?: string[];
  messageType?: MessageType;
  sinceTimestamp?: Date;
  beforeTimestamp?: Date;
}

export class CommunicationService {
  private commRepo: CommunicationRepository;
  private fairShareScheduler: FairShareScheduler;

  constructor(private db: DatabaseManager) {
    this.commRepo = new CommunicationRepository(db);
    this.fairShareScheduler = new FairShareScheduler();
  }

  // Room management
  async createRoom(request: CreateRoomRequest): Promise<ChatRoom> {
    // Resolve repository path to absolute path
    const resolvedRepositoryPath = PathUtils.resolveRepositoryPath(request.repositoryPath, 'room creation');
    
    // Check if room already exists
    const existingRoom = await this.commRepo.getRoomByName(request.name);
    if (existingRoom) {
      throw new Error(`Room ${request.name} already exists`);
    }

    const roomData: NewChatRoom = {
      id: `room-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: request.name,
      description: request.description,
      repositoryPath: resolvedRepositoryPath,
      isGeneral: request.isGeneral || false,
      roomMetadata: request.metadata || {}
    };

    const room = await this.commRepo.createRoom(roomData);
    
    // Emit room created event
    await eventBus.emit('room_created', {
      room,
      timestamp: new Date(),
      repositoryPath: resolvedRepositoryPath
    });
    
    return room;
  }

  async getRoom(roomName: string): Promise<ChatRoom | null> {
    return await this.commRepo.getRoomByName(roomName);
  }

  async getRoomById(roomId: string): Promise<ChatRoom | null> {
    return await this.commRepo.getRoomById(roomId);
  }

  async getOrCreateGeneralRoom(repositoryPath: string): Promise<ChatRoom> {
    const resolvedRepositoryPath = PathUtils.resolveRepositoryPath(repositoryPath, 'get or create general room');
    return await this.commRepo.findOrCreateGeneralRoom(resolvedRepositoryPath);
  }

  async listRooms(repositoryPath: string): Promise<ChatRoom[]> {
    const resolvedRepositoryPath = PathUtils.resolveRepositoryPath(repositoryPath, 'list rooms');
    return await this.commRepo.listRooms(resolvedRepositoryPath);
  }

  async updateRoomMetadata(roomName: string, metadata: Record<string, any>): Promise<void> {
    const room = await this.commRepo.getRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    // Update room using base repository update method
    await this.commRepo.update(roomName, { roomMetadata: metadata });
  }

  async deleteRoom(roomName: string): Promise<void> {
    const room = await this.commRepo.getRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    await this.commRepo.deleteRoom(roomName);
    
    // Emit room closed event
    await eventBus.emit('room_closed', {
      roomId: room.name, // Using name as ID since it's the primary key
      roomName: room.name,
      timestamp: new Date(),
      repositoryPath: room.repositoryPath
    });
  }

  // Message management
  async sendMessage(request: SendMessageRequest): Promise<ChatMessage> {
    // Validate room exists
    const room = await this.commRepo.getRoomByName(request.roomName);
    if (!room) {
      throw new Error(`Room ${request.roomName} not found`);
    }

    const messageId = this.generateMessageId();
    const messageData: NewChatMessage = {
      id: messageId,
      roomId: room.id,
      agentName: request.agentName,
      message: request.message,
      mentions: request.mentions || [],
      messageType: request.messageType || 'standard'
    };

    const message = await this.commRepo.sendMessage(messageData);

    // Emit room message event
    await eventBus.emit('room_message', {
      roomId: room.name, // Using name as ID since it's the primary key
      roomName: room.name,
      message,
      timestamp: new Date(),
      repositoryPath: room.repositoryPath
    });

    // Process mentions and notifications
    if (request.mentions && request.mentions.length > 0) {
      this.processMentions(request.mentions, request.roomName, request.agentName, request.message);
    }

    return message;
  }

  async getMessage(messageId: string): Promise<ChatMessage | null> {
    // Use getMessages with filter to find by ID
    const messages = await this.commRepo.getMessages({
      limit: 1,
      offset: 0
    });
    return messages.find(msg => msg.id === messageId) || null;
  }

  async getMessages(roomName: string, limit = 100, sinceTimestamp?: Date): Promise<ChatMessage[]> {
    const room = await this.commRepo.getRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    const filter: MessageFilter = {
      roomName,
      limit,
      offset: 0,
      since: sinceTimestamp?.toISOString()
    };

    return await this.commRepo.getMessages(filter);
  }

  async getRecentMessages(roomName: string, limit = 50): Promise<ChatMessage[]> {
    const room = await this.commRepo.getRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    return await this.commRepo.getRecentMessages(roomName, limit);
  }

  async getAgentMessages(agentName: string, limit = 100): Promise<ChatMessage[]> {
    const filter: MessageFilter = {
      agentName,
      limit,
      offset: 0
    };
    return await this.commRepo.getMessages(filter);
  }

  async getMentionedMessages(agentName: string, limit = 50): Promise<ChatMessage[]> {
    const filter: MessageFilter = {
      mentions: agentName,
      limit,
      offset: 0
    };
    return await this.commRepo.getMessages(filter);
  }

  async searchMessages(roomName: string, query: string, limit = 50): Promise<ChatMessage[]> {
    const room = await this.commRepo.getRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    const filter: MessageFilter = {
      roomName,
      containsText: query,
      limit,
      offset: 0
    };

    return await this.commRepo.getMessages(filter);
  }

  async deleteMessage(messageId: string): Promise<void> {
    const message = await this.getMessage(messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    await this.commRepo.deleteMessage(messageId);
  }

  // Room participation and statistics
  async getRoomParticipants(roomName: string): Promise<string[]> {
    const room = await this.commRepo.getRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    return await this.commRepo.getRoomParticipants(roomName);
  }

  async getRoomStats(roomName: string): Promise<{
    messageCount: number;
    participantCount: number;
    participants: string[];
    lastActivity?: string;
  }> {
    const room = await this.commRepo.getRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    const messageCount = await this.commRepo.getMessageCount(roomName);
    const participants = await this.commRepo.getRoomParticipants(roomName);
    const recentMessages = await this.commRepo.getRecentMessages(roomName, 1);
    
    return {
      messageCount,
      participantCount: participants.length,
      participants,
      lastActivity: recentMessages.length > 0 ? recentMessages[0].timestamp : undefined
    };
  }

  // Agent coordination features
  async joinRoom(roomName: string, agentName: string): Promise<void> {
    const room = await this.commRepo.getRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    // Send join notification
    await this.sendMessage({
      roomName,
      agentName: 'SYSTEM',
      message: `${agentName} joined the room`,
      messageType: 'system'
    });
  }

  async leaveRoom(roomName: string, agentName: string): Promise<void> {
    const room = await this.commRepo.getRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    // Send leave notification
    await this.sendMessage({
      roomName,
      agentName: 'SYSTEM',
      message: `${agentName} left the room`,
      messageType: 'system'
    });
  }

  // Broadcast to all agents in a room
  async broadcastToRoom(
    roomName: string,
    fromAgent: string,
    message: string,
    messageType: MessageType = 'standard'
  ): Promise<ChatMessage> {
    const room = await this.commRepo.getRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    const participants = await this.commRepo.getRoomParticipants(roomName);
    const mentions = participants.filter((p: string) => p !== fromAgent);

    return await this.sendMessage({
      roomName,
      agentName: fromAgent,
      message,
      mentions,
      messageType
    });
  }

  // Wait for messages (polling-based for now)
  async waitForMessages(
    roomName: string,
    sinceTimestamp?: Date,
    timeout = 30000
  ): Promise<ChatMessage[]> {
    const room = await this.commRepo.getRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    // Implement polling-based wait since repository method doesn't exist
    return new Promise((resolve) => {
      const startTime = Date.now();
      const since = sinceTimestamp?.toISOString();
      
      const checkMessages = async () => {
        try {
          const filter: MessageFilter = {
            roomName,
            since,
            limit: 50,
            offset: 0
          };
          const messages = await this.commRepo.getMessages(filter);
          
          if (messages.length > 0) {
            resolve(messages);
            return;
          }

          if (Date.now() - startTime > timeout) {
            resolve([]);
            return;
          }

          // Poll again in 2 seconds
          setTimeout(() => checkMessages().catch(console.error), 2000);
        } catch (error) {
          console.error('Error checking messages:', error);
          resolve([]);
        }
      };

      checkMessages().catch(console.error);
    });
  }

  // Wait for specific mentions
  async waitForMentions(
    agentName: string,
    roomName?: string,
    timeout = 30000
  ): Promise<ChatMessage[]> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const sinceTimestamp = new Date();
      
      const checkMentions = async () => {
        let messages: ChatMessage[];
        
        if (roomName) {
          // Check specific room for mentions
          const allMessages = await this.commRepo.getMessages({
            roomName,
            limit: 50,
            offset: 0,
            since: sinceTimestamp.toISOString()
          });
          messages = allMessages.filter((msg: ChatMessage) => (msg.mentions || []).includes(agentName));
        } else {
          // Check all rooms for mentions
          const allMessages = await this.commRepo.getMessages({
            limit: 50,
            offset: 0,
            since: sinceTimestamp.toISOString()
          });
          messages = allMessages.filter((msg: ChatMessage) => (msg.mentions || []).includes(agentName));
        }
        
        if (messages.length > 0) {
          resolve(messages);
          return;
        }

        if (Date.now() - startTime > timeout) {
          resolve([]);
          return;
        }

        // Poll again in 2 seconds
        setTimeout(() => checkMentions().catch(console.error), 2000);
      };

      checkMentions().catch(console.error);
    });
  }

  // Agent status broadcasting
  async broadcastAgentStatus(
    agentName: string,
    status: string,
    repositoryPath: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    const rooms = await this.commRepo.listRooms(repositoryPath);
    
    const statusMessage = `Agent ${agentName} status: ${status}`;
    const fullMessage = metadata 
      ? `${statusMessage} - ${JSON.stringify(metadata)}`
      : statusMessage;

    for (const room of rooms) {
      await this.sendMessage({
        roomName: room.name,
        agentName: 'SYSTEM',
        message: fullMessage,
        messageType: 'status_update'
      });
    }
  }

  // On-demand room creation for agents
  async createRoomForAgent(
    agentName: string,
    repositoryPath: string,
    reason: string,
    participants: string[] = []
  ): Promise<{
    roomName: string;
    room: ChatRoom;
    joined: boolean;
  }> {
    // Generate consistent room name based on reason/task (NOT timestamp!)
    // This ensures all agents working on the same task join the same room
    const normalizedReason = reason
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') // trim leading/trailing dashes
      .substring(0, 50);
    
    const roomName = `coordination-${normalizedReason}`;
    
    // Try to get existing room first
    try {
      const existingRoom = await this.getRoom(roomName);
      if (existingRoom) {
        // Room already exists, just join it
        await this.joinRoom(roomName, agentName);
        await this.sendMessage({
          roomName,
          agentName,
          message: `${agentName} joined existing coordination room`,
          messageType: 'system'
        });
        return {
          roomName,
          room: existingRoom,
          joined: true
        };
      }
    } catch (error) {
      // Room doesn't exist, create it
    }
    
    // Create room with agent coordination metadata
    const room = await this.createRoom({
      name: roomName,
      description: `Agent coordination room created by ${agentName}: ${reason}`,
      repositoryPath,
      metadata: {
        createdBy: agentName,
        reason,
        participants,
        onDemandCreation: true,
        createdAt: new Date().toISOString()
      }
    });

    // Join the creating agent to the room
    await this.joinRoom(roomName, agentName);

    // Send initial message about room creation
    await this.sendMessage({
      roomName,
      agentName,
      message: `Coordination room created. Reason: ${reason}`,
      messageType: 'coordination'
    });

    return {
      roomName,
      room,
      joined: true
    };
  }

  // Clean up old messages
  async cleanupOldMessages(repositoryPath: string, olderThanDays = 7): Promise<number> {
    const resolvedRepositoryPath = PathUtils.resolveRepositoryPath(repositoryPath, 'cleanup old messages');
    const rooms = await this.commRepo.listRooms(resolvedRepositoryPath);
    let totalDeleted = 0;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    for (const room of rooms) {
      const deleted = await this.commRepo.deleteOldMessages(room.id, cutoffDate);
      totalDeleted += deleted;
    }

    return totalDeleted;
  }

  // Agent conversation summaries
  async getConversationSummary(roomName: string, limit = 100): Promise<{
    room: ChatRoom;
    messageCount: number;
    participants: string[];
    recentMessages: ChatMessage[];
    mentionCounts: Record<string, number>;
  }> {
    const room = await this.commRepo.getRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    const recentMessages = await this.commRepo.getRecentMessages(room.id, limit);
    const participants = await this.commRepo.getRoomParticipants(room.id);
    const messageCount = await this.commRepo.getMessageCount(room.id);
    
    // Count mentions per agent
    const mentionCounts: Record<string, number> = {};
    for (const message of recentMessages) {
      for (const mention of message.mentions || []) {
        mentionCounts[mention] = (mentionCounts[mention] || 0) + 1;
      }
    }

    return {
      room,
      messageCount,
      participants,
      recentMessages,
      mentionCounts
    };
  }

  // Fair Share Communication Methods

  /**
   * Get next agent who should speak based on fair share priority
   */
  async getNextSpeaker(roomName: string): Promise<string | null> {
    const participants = await this.getRoomParticipants(roomName);
    return this.fairShareScheduler.getNextSpeaker(roomName, participants);
  }

  /**
   * Update agent work state for priority calculation
   */
  updateAgentWorkState(agentId: string, state: 'idle' | 'active' | 'blocked' | 'critical' | 'completing'): void {
    this.fairShareScheduler.updateAgentWorkState(agentId, state);
  }

  /**
   * Set phase leadership role for priority calculation
   */
  setPhaseRole(agentId: string, role: 'leader' | 'participant' | 'observer'): void {
    this.fairShareScheduler.setPhaseRole(agentId, role);
  }

  /**
   * Check if agent should be allowed to speak (fair share enforcement)
   */
  async shouldAllowMessage(roomName: string, agentId: string): Promise<{ allowed: boolean; reason: string }> {
    const nextSpeaker = await this.getNextSpeaker(roomName);

    if (!nextSpeaker) {
      return { allowed: true, reason: 'No other participants' };
    }

    if (nextSpeaker === agentId) {
      return { allowed: true, reason: 'Highest priority speaker' };
    }

    // Check if agent has critical priority that overrides turn order
    const agentPriority = this.fairShareScheduler.calculateCommunicationPriority(agentId);
    const nextSpeakerPriority = this.fairShareScheduler.calculateCommunicationPriority(nextSpeaker);

    if (agentPriority.priority >= 8.0) {
      return { allowed: true, reason: `Critical priority (${agentPriority.priority.toFixed(1)})` };
    }

    if (agentPriority.priority > nextSpeakerPriority.priority + 2.0) {
      return { allowed: true, reason: `Significantly higher priority (+${(agentPriority.priority - nextSpeakerPriority.priority).toFixed(1)})` };
    }

    return {
      allowed: false,
      reason: `${nextSpeaker} has higher priority (${nextSpeakerPriority.priority.toFixed(1)} vs ${agentPriority.priority.toFixed(1)})`
    };
  }

  /**
   * Send message with fair share priority enforcement
   */
  async sendPriorityMessage(request: SendMessageRequest, enforceFairShare = true): Promise<ChatMessage> {
    if (enforceFairShare && request.messageType !== 'system') {
      const priorityCheck = await this.shouldAllowMessage(request.roomName, request.agentName);

      if (!priorityCheck.allowed) {
        throw new Error(`Message blocked by fair share scheduler: ${priorityCheck.reason}`);
      }
    }

    // Use existing sendMessage method
    return await this.sendMessage(request);
  }

  /**
   * Get communication priority debugging info
   */
  getCommunicationDebugInfo(agentId: string): {
    metrics: any;
    priority: any;
    recentHistory: any[];
  } {
    return {
      metrics: this.fairShareScheduler.getAgentMetrics(agentId),
      priority: this.fairShareScheduler.calculateCommunicationPriority(agentId),
      recentHistory: this.fairShareScheduler.getPriorityHistory(10)
    };
  }

  private processMentions(
    mentions: string[],
    roomName: string,
    fromAgent: string,
    message: string
  ): void {
    // For now, mentions are just stored in the database
    // In a real implementation, you might want to:
    // - Send notifications to mentioned agents
    // - Trigger webhooks or events
    // - Update agent attention/priority systems

    process.stderr.write(`Processing mentions in ${roomName}: ${mentions.join(', ')}\\n`);
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}