import { DatabaseManager } from '../database/index.js';
import { CommunicationRepository } from '../repositories/CommunicationRepository.js';
import { PathUtils } from '../utils/pathUtils.js';
import type { ChatRoom, ChatMessage, NewChatRoom, NewChatMessage, MessageType, MessageFilter, SendMessageRequest } from '../schemas/index.js';

export interface CreateRoomRequest {
  name: string;
  description: string;
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

  constructor(private db: DatabaseManager) {
    this.commRepo = new CommunicationRepository(db);
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
      name: request.name,
      description: request.description,
      repositoryPath: resolvedRepositoryPath,
      roomMetadata: request.metadata || {}
    };

    return await this.commRepo.createRoom(roomData);
  }

  async getRoom(roomName: string): Promise<ChatRoom | null> {
    return await this.commRepo.getRoomByName(roomName);
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
      roomName: request.roomName,
      agentName: request.agentName,
      message: request.message,
      mentions: request.mentions || [],
      messageType: request.messageType || 'standard'
    };

    const message = await this.commRepo.sendMessage(messageData);

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

  // Clean up old messages
  async cleanupOldMessages(repositoryPath: string, olderThanDays = 7): Promise<number> {
    const resolvedRepositoryPath = PathUtils.resolveRepositoryPath(repositoryPath, 'cleanup old messages');
    const rooms = await this.commRepo.listRooms(resolvedRepositoryPath);
    let totalDeleted = 0;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    for (const room of rooms) {
      const deleted = await this.commRepo.deleteOldMessages(room.name, cutoffDate);
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

    const recentMessages = await this.commRepo.getRecentMessages(roomName, limit);
    const participants = await this.commRepo.getRoomParticipants(roomName);
    const messageCount = await this.commRepo.getMessageCount(roomName);
    
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