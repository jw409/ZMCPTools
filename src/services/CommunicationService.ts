import { ClaudeDatabase } from '../database/index.js';
import { CommunicationRepository } from './repositories/CommunicationRepository.js';
import { ChatRoom, ChatMessage, MessageType } from '../models/index.js';
import type { ChatRoomData, ChatMessageData } from '../models/index.js';

export interface CreateRoomRequest {
  name: string;
  description: string;
  repositoryPath: string;
  metadata?: Record<string, any>;
}

export interface SendMessageRequest {
  roomName: string;
  agentName: string;
  message: string;
  mentions?: string[];
  messageType?: MessageType;
}

export interface MessageFilter {
  roomName?: string;
  agentName?: string;
  mentions?: string[];
  messageType?: MessageType;
  sinceTimestamp?: Date;
  beforeTimestamp?: Date;
}

export class CommunicationService {
  private commRepo: CommunicationRepository;

  constructor(private db: ClaudeDatabase) {
    this.commRepo = new CommunicationRepository(db);
  }

  // Room management
  createRoom(request: CreateRoomRequest): ChatRoom {
    // Check if room already exists
    const existingRoom = this.commRepo.findRoomByName(request.name);
    if (existingRoom) {
      throw new Error(`Room ${request.name} already exists`);
    }

    const roomData: Omit<ChatRoomData, 'created_at'> = {
      name: request.name,
      description: request.description,
      repository_path: request.repositoryPath,
      room_metadata: request.metadata || {}
    };

    return this.commRepo.createRoom(roomData);
  }

  getRoom(roomName: string): ChatRoom | null {
    return this.commRepo.findRoomByName(roomName);
  }

  listRooms(repositoryPath: string): ChatRoom[] {
    return this.commRepo.findRoomsByRepository(repositoryPath);
  }

  updateRoomMetadata(roomName: string, metadata: Record<string, any>): void {
    const room = this.commRepo.findRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    this.commRepo.updateRoomMetadata(roomName, metadata);
  }

  deleteRoom(roomName: string): void {
    const room = this.commRepo.findRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    this.commRepo.deleteRoom(roomName);
  }

  // Message management
  sendMessage(request: SendMessageRequest): ChatMessage {
    // Validate room exists
    const room = this.commRepo.findRoomByName(request.roomName);
    if (!room) {
      throw new Error(`Room ${request.roomName} not found`);
    }

    const messageId = this.generateMessageId();
    const messageData: Omit<ChatMessageData, 'timestamp'> = {
      id: messageId,
      room_name: request.roomName,
      agent_name: request.agentName,
      message: request.message,
      mentions: request.mentions || [],
      message_type: request.messageType || MessageType.STANDARD
    };

    const message = this.commRepo.sendMessage(messageData);

    // Process mentions and notifications
    if (request.mentions && request.mentions.length > 0) {
      this.processMentions(request.mentions, request.roomName, request.agentName, request.message);
    }

    return message;
  }

  getMessage(messageId: string): ChatMessage | null {
    return this.commRepo.findMessageById(messageId);
  }

  getMessages(roomName: string, limit = 100, sinceTimestamp?: Date): ChatMessage[] {
    const room = this.commRepo.findRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    return this.commRepo.getMessages(roomName, limit, sinceTimestamp);
  }

  getRecentMessages(roomName: string, limit = 50): ChatMessage[] {
    const room = this.commRepo.findRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    return this.commRepo.getRecentMessages(roomName, limit);
  }

  getAgentMessages(agentName: string, limit = 100): ChatMessage[] {
    return this.commRepo.findMessagesByAgent(agentName, limit);
  }

  getMentionedMessages(agentName: string, limit = 50): ChatMessage[] {
    return this.commRepo.findMessagesByMention(agentName, limit);
  }

  searchMessages(roomName: string, query: string, limit = 50): ChatMessage[] {
    const room = this.commRepo.findRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    return this.commRepo.searchMessages(roomName, query, limit);
  }

  deleteMessage(messageId: string): void {
    const message = this.commRepo.findMessageById(messageId);
    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    this.commRepo.deleteMessage(messageId);
  }

  // Room participation and statistics
  getRoomParticipants(roomName: string): string[] {
    const room = this.commRepo.findRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    return this.commRepo.getRoomParticipants(roomName);
  }

  getRoomStats(roomName: string): {
    messageCount: number;
    participantCount: number;
    participants: string[];
    lastActivity?: Date;
  } {
    const room = this.commRepo.findRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    const messageCount = this.commRepo.getMessageCount(roomName);
    const participants = this.commRepo.getRoomParticipants(roomName);
    const recentMessages = this.commRepo.getRecentMessages(roomName, 1);
    
    return {
      messageCount,
      participantCount: participants.length,
      participants,
      lastActivity: recentMessages.length > 0 ? recentMessages[0].timestamp : undefined
    };
  }

  // Agent coordination features
  async joinRoom(roomName: string, agentName: string): Promise<void> {
    const room = this.commRepo.findRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    // Send join notification
    await this.sendMessage({
      roomName,
      agentName: 'SYSTEM',
      message: `${agentName} joined the room`,
      messageType: MessageType.SYSTEM
    });
  }

  async leaveRoom(roomName: string, agentName: string): Promise<void> {
    const room = this.commRepo.findRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    // Send leave notification
    await this.sendMessage({
      roomName,
      agentName: 'SYSTEM',
      message: `${agentName} left the room`,
      messageType: MessageType.SYSTEM
    });
  }

  // Broadcast to all agents in a room
  async broadcastToRoom(
    roomName: string,
    fromAgent: string,
    message: string,
    messageType: MessageType = MessageType.BROADCAST
  ): Promise<ChatMessage> {
    const room = this.commRepo.findRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    const participants = this.commRepo.getRoomParticipants(roomName);
    const mentions = participants.filter(p => p !== fromAgent);

    return this.sendMessage({
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
    const room = this.commRepo.findRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    return this.commRepo.waitForMessages(roomName, sinceTimestamp, timeout);
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
      
      const checkMentions = () => {
        let messages: ChatMessage[];
        
        if (roomName) {
          // Check specific room for mentions
          messages = this.commRepo.getMessages(roomName, 50, sinceTimestamp)
            .filter(msg => (msg.mentions || []).includes(agentName));
        } else {
          // Check all rooms for mentions
          messages = this.commRepo.findMessagesByMention(agentName, 50)
            .filter(msg => msg.timestamp >= sinceTimestamp);
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
        setTimeout(checkMentions, 2000);
      };

      checkMentions();
    });
  }

  // Agent status broadcasting
  async broadcastAgentStatus(
    agentName: string,
    status: string,
    repositoryPath: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    const rooms = this.commRepo.findRoomsByRepository(repositoryPath);
    
    const statusMessage = `Agent ${agentName} status: ${status}`;
    const fullMessage = metadata 
      ? `${statusMessage} - ${JSON.stringify(metadata)}`
      : statusMessage;

    for (const room of rooms) {
      await this.sendMessage({
        roomName: room.name,
        agentName: 'SYSTEM',
        message: fullMessage,
        messageType: MessageType.STATUS
      });
    }
  }

  // Clean up old messages
  cleanupOldMessages(repositoryPath: string, olderThanDays = 7): number {
    const rooms = this.commRepo.findRoomsByRepository(repositoryPath);
    let totalDeleted = 0;

    for (const room of rooms) {
      const deleted = this.commRepo.deleteOldMessages(room.name, olderThanDays);
      totalDeleted += deleted;
    }

    return totalDeleted;
  }

  // Agent conversation summaries
  getConversationSummary(roomName: string, limit = 100): {
    room: ChatRoom;
    messageCount: number;
    participants: string[];
    recentMessages: ChatMessage[];
    mentionCounts: Record<string, number>;
  } {
    const room = this.commRepo.findRoomByName(roomName);
    if (!room) {
      throw new Error(`Room ${roomName} not found`);
    }

    const recentMessages = this.commRepo.getRecentMessages(roomName, limit);
    const participants = this.commRepo.getRoomParticipants(roomName);
    const messageCount = this.commRepo.getMessageCount(roomName);
    
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
    
    console.log(`Processing mentions in ${roomName}: ${mentions.join(', ')}`);
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}