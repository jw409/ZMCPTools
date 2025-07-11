import { eq, and, or, like, gte, lte, lt, desc, asc, sql } from 'drizzle-orm';
import { BaseRepository, createRepositoryConfig, RepositoryError } from './index.js';
import { DatabaseManager } from '../database/index.js';
import {
  chatRooms,
  chatMessages,
  roomParticipants,
  insertChatRoomSchema,
  selectChatRoomSchema,
  updateChatRoomSchema,
  insertChatMessageSchema,
  selectChatMessageSchema,
  insertRoomParticipantSchema,
  selectRoomParticipantSchema,
  updateRoomParticipantSchema,
  type ChatRoom,
  type NewChatRoom,
  type ChatRoomUpdate,
  type ChatMessage,
  type NewChatMessage,
  type RoomParticipant,
  type NewRoomParticipant,
  type RoomParticipantUpdate,
  type MessageFilter,
  type ParticipantFilter,
} from '../schemas/index.js';

/**
 * Repository for managing communication rooms and messages
 */
export class CommunicationRepository extends BaseRepository<
  typeof chatRooms,
  ChatRoom,
  NewChatRoom,
  ChatRoomUpdate
> {
  constructor(drizzleManager: DatabaseManager) {
    super(drizzleManager, createRepositoryConfig(
      chatRooms,
      chatRooms.id,
      insertChatRoomSchema,
      selectChatRoomSchema,
      updateChatRoomSchema,
      'communication-repository'
    ));
  }

  /**
   * Create a new chat room
   */
  async createRoom(data: NewChatRoom): Promise<ChatRoom> {
    // Generate ID if not provided
    if (!data.id) {
      data.id = `room-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    return await super.create(data);
  }

  /**
   * Get a chat room by ID
   */
  async getRoomById(id: string): Promise<ChatRoom | null> {
    try {
      const result = await this.drizzle
        .select()
        .from(chatRooms)
        .where(eq(chatRooms.id, id))
        .limit(1)
        .execute();

      return result[0] || null;
    } catch (error) {
      throw new RepositoryError(
        `Failed to get room by ID: ${id}`,
        'getRoomById',
        this.getTableName(),
        error
      );
    }
  }

  /**
   * Get a chat room by name
   */
  async getRoomByName(name: string): Promise<ChatRoom | null> {
    try {
      const result = await this.drizzle
        .select()
        .from(chatRooms)
        .where(eq(chatRooms.name, name))
        .limit(1)
        .execute();

      return result[0] || null;
    } catch (error) {
      throw new RepositoryError(
        `Failed to get room by name: ${name}`,
        'getRoomByName',
        this.getTableName(),
        error
      );
    }
  }

  /**
   * Send a message to a chat room
   */
  async sendMessage(data: NewChatMessage): Promise<ChatMessage> {
    try {
      const validatedData = insertChatMessageSchema.parse(data);
      
      // Ensure the sender is tracked as a participant
      // Generate agentId from agentName if not available elsewhere
      const agentId = `agent-${validatedData.agentName}`;
      await this.ensureParticipantTracked(
        validatedData.roomId,
        agentId,
        validatedData.agentName
      );
      
      const result = await this.drizzle
        .insert(chatMessages)
        .values(validatedData as any)
        .returning()
        .execute();

      const parsed = selectChatMessageSchema.parse(result[0]);
      return {
        ...parsed,
        messageType: parsed.messageType as ChatMessage['messageType']
      };
    } catch (error) {
      throw new RepositoryError(
        'Failed to send message',
        'sendMessage',
        'chat_messages',
        error
      );
    }
  }

  /**
   * Get messages from a room with filtering
   */
  async getMessages(filter: MessageFilter): Promise<ChatMessage[]> {
    try {
      // Build WHERE conditions
      const conditions = [];

      if (filter.roomId) {
        conditions.push(eq(chatMessages.roomId, filter.roomId));
      } else if (filter.roomName) {
        // Support backwards compatibility by looking up room ID from name
        const room = await this.getRoomByName(filter.roomName);
        if (room) {
          conditions.push(eq(chatMessages.roomId, room.id));
        }
      }

      if (filter.agentName) {
        conditions.push(eq(chatMessages.agentName, filter.agentName));
      }

      if (filter.messageType) {
        conditions.push(eq(chatMessages.messageType, filter.messageType));
      }

      if (filter.since) {
        conditions.push(gte(chatMessages.timestamp, filter.since));
      }

      if (filter.until) {
        conditions.push(lte(chatMessages.timestamp, filter.until));
      }

      if (filter.containsText) {
        conditions.push(like(chatMessages.message, `%${filter.containsText}%`));
      }

      if (filter.mentions) {
        conditions.push(like(chatMessages.mentions, `%${filter.mentions}%`));
      }

      // Build final query
      const baseQuery = this.drizzle.select().from(chatMessages);
      
      const result = await (conditions.length > 0 
        ? baseQuery.where(and(...conditions))
        : baseQuery)
        .orderBy(desc(chatMessages.timestamp))
        .limit(filter.limit)
        .offset(filter.offset)
        .execute();

      return result.map(row => {
        const parsed = selectChatMessageSchema.parse(row);
        return {
          ...parsed,
          messageType: parsed.messageType as ChatMessage['messageType']
        };
      });
    } catch (error) {
      throw new RepositoryError(
        'Failed to get messages',
        'getMessages',
        'chat_messages',
        error
      );
    }
  }

  /**
   * Get messages since a specific timestamp
   */
  async getMessagesSince(roomId: string, sinceTimestamp: string): Promise<ChatMessage[]> {
    try {
      const result = await this.drizzle
        .select()
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.roomId, roomId),
            gte(chatMessages.timestamp, sinceTimestamp)
          )
        )
        .orderBy(asc(chatMessages.timestamp))
        .execute();

      return result.map(row => {
        const parsed = selectChatMessageSchema.parse(row);
        return {
          ...parsed,
          messageType: parsed.messageType as ChatMessage['messageType']
        };
      });
    } catch (error) {
      throw new RepositoryError(
        `Failed to get messages since ${sinceTimestamp}`,
        'getMessagesSince',
        'chat_messages',
        error
      );
    }
  }

  /**
   * Get messages since a specific timestamp by room name (backwards compatibility)
   */
  async getMessagesSinceByName(roomName: string, sinceTimestamp: string): Promise<ChatMessage[]> {
    try {
      const room = await this.getRoomByName(roomName);
      if (!room) {
        throw new Error(`Room not found: ${roomName}`);
      }
      return await this.getMessagesSince(room.id, sinceTimestamp);
    } catch (error) {
      throw new RepositoryError(
        `Failed to get messages since ${sinceTimestamp} for room ${roomName}`,
        'getMessagesSinceByName',
        'chat_messages',
        error
      );
    }
  }

  /**
   * List all rooms, optionally filtered by repository path
   */
  async listRooms(repositoryPath?: string): Promise<ChatRoom[]> {
    try {
      const baseQuery = this.drizzle.select().from(chatRooms);

      const result = await (repositoryPath
        ? baseQuery.where(eq(chatRooms.repositoryPath, repositoryPath))
        : baseQuery)
        .orderBy(desc(chatRooms.createdAt))
        .execute();

      return result.map(row => selectChatRoomSchema.parse(row));
    } catch (error) {
      throw new RepositoryError(
        'Failed to list rooms',
        'listRooms',
        this.getTableName(),
        error
      );
    }
  }

  /**
   * Delete a room and all its messages by ID
   */
  async deleteRoom(id: string): Promise<boolean> {
    try {
      // Delete in proper order: messages -> participants -> room
      await this.drizzle
        .delete(chatMessages)
        .where(eq(chatMessages.roomId, id))
        .execute();

      // Delete participants
      await this.drizzle
        .delete(roomParticipants)
        .where(eq(roomParticipants.roomId, id))
        .execute();

      // Delete room
      const result = await this.drizzle
        .delete(chatRooms)
        .where(eq(chatRooms.id, id))
        .execute();

      return result.changes > 0;
    } catch (error) {
      throw new RepositoryError(
        `Failed to delete room: ${id}`,
        'deleteRoom',
        this.getTableName(),
        error
      );
    }
  }

  /**
   * Delete a room and all its messages by name (backwards compatibility)
   */
  async deleteRoomByName(name: string): Promise<boolean> {
    try {
      const room = await this.getRoomByName(name);
      if (!room) {
        return false;
      }
      return await this.deleteRoom(room.id);
    } catch (error) {
      throw new RepositoryError(
        `Failed to delete room by name: ${name}`,
        'deleteRoomByName',
        this.getTableName(),
        error
      );
    }
  }

  /**
   * Get room participants (agent names from participants table)
   */
  async getRoomParticipants(roomId: string): Promise<string[]> {
    try {
      const result = await this.drizzle
        .select({ agentName: roomParticipants.agentName })
        .from(roomParticipants)
        .where(and(
          eq(roomParticipants.roomId, roomId),
          eq(roomParticipants.status, 'active')
        ))
        .execute();

      return result.map(row => row.agentName);
    } catch (error) {
      throw new RepositoryError(
        `Failed to get room participants: ${roomId}`,
        'getRoomParticipants',
        'room_participants',
        error
      );
    }
  }

  /**
   * Get room participants by name (backwards compatibility)
   */
  async getRoomParticipantsByName(roomName: string): Promise<string[]> {
    try {
      const room = await this.getRoomByName(roomName);
      if (!room) {
        return [];
      }
      return await this.getRoomParticipants(room.id);
    } catch (error) {
      throw new RepositoryError(
        `Failed to get room participants by name: ${roomName}`,
        'getRoomParticipantsByName',
        'chat_messages',
        error
      );
    }
  }

  /**
   * Get message count for a room
   */
  async getMessageCount(roomId: string): Promise<number> {
    try {
      const result = await this.drizzle
        .select({ count: sql`count(*)`.as('count') })
        .from(chatMessages)
        .where(eq(chatMessages.roomId, roomId))
        .execute();

      return Number(result[0]?.count || 0);
    } catch (error) {
      throw new RepositoryError(
        `Failed to get message count: ${roomId}`,
        'getMessageCount',
        'chat_messages',
        error
      );
    }
  }

  /**
   * Get message count by room name (backwards compatibility)
   */
  async getMessageCountByName(roomName: string): Promise<number> {
    try {
      const room = await this.getRoomByName(roomName);
      if (!room) {
        return 0;
      }
      return await this.getMessageCount(room.id);
    } catch (error) {
      throw new RepositoryError(
        `Failed to get message count by name: ${roomName}`,
        'getMessageCountByName',
        'chat_messages',
        error
      );
    }
  }

  /**
   * Get recent messages from a room
   */
  async getRecentMessages(roomId: string, limit: number = 50): Promise<ChatMessage[]> {
    try {
      const result = await this.drizzle
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.roomId, roomId))
        .orderBy(desc(chatMessages.timestamp))
        .limit(limit)
        .execute();

      return result.map(row => {
        const parsed = selectChatMessageSchema.parse(row);
        return {
          ...parsed,
          messageType: parsed.messageType as ChatMessage['messageType']
        };
      });
    } catch (error) {
      throw new RepositoryError(
        `Failed to get recent messages: ${roomId}`,
        'getRecentMessages',
        'chat_messages',
        error
      );
    }
  }

  /**
   * Get recent messages by room name (backwards compatibility)
   */
  async getRecentMessagesByName(roomName: string, limit: number = 50): Promise<ChatMessage[]> {
    try {
      const room = await this.getRoomByName(roomName);
      if (!room) {
        return [];
      }
      return await this.getRecentMessages(room.id, limit);
    } catch (error) {
      throw new RepositoryError(
        `Failed to get recent messages by name: ${roomName}`,
        'getRecentMessagesByName',
        'chat_messages',
        error
      );
    }
  }

  /**
   * Find room by name (synchronous version for compatibility)
   */
  findRoomByName(name: string): Promise<ChatRoom | null> {
    return this.getRoomByName(name);
  }

  /**
   * Find room by ID (synchronous version for compatibility)
   */
  findRoomById(id: string): Promise<ChatRoom | null> {
    return this.getRoomById(id);
  }

  /**
   * Delete a message by ID
   */
  async deleteMessage(messageId: string): Promise<boolean> {
    try {
      const result = await this.drizzle
        .delete(chatMessages)
        .where(eq(chatMessages.id, messageId))
        .execute();

      return result.changes > 0;
    } catch (error) {
      throw new RepositoryError(
        `Failed to delete message: ${messageId}`,
        'deleteMessage',
        'chat_messages',
        error
      );
    }
  }

  /**
   * Find rooms by repository path
   */
  async findRoomsByRepository(repositoryPath: string): Promise<ChatRoom[]> {
    try {
      return await this.drizzle
        .select()
        .from(chatRooms)
        .where(eq(chatRooms.repositoryPath, repositoryPath))
        .execute();
    } catch (error) {
      throw new RepositoryError(
        `Failed to find rooms by repository: ${repositoryPath}`,
        'findRoomsByRepository',
        'chat_rooms',
        error
      );
    }
  }

  /**
   * Find or create general room for a repository
   */
  async findOrCreateGeneralRoom(repositoryPath: string): Promise<ChatRoom> {
    try {
      // First try to find existing general room
      const existingRooms = await this.drizzle
        .select()
        .from(chatRooms)
        .where(
          and(
            eq(chatRooms.repositoryPath, repositoryPath),
            eq(chatRooms.isGeneral, true)
          )
        )
        .limit(1)
        .execute();

      if (existingRooms.length > 0) {
        return existingRooms[0];
      }

      // Create new general room
      const roomId = `general-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newRoom: NewChatRoom = {
        id: roomId,
        name: `general-${repositoryPath.split('/').pop() || 'project'}`,
        description: `General communication room for ${repositoryPath}`,
        repositoryPath,
        isGeneral: true,
        roomMetadata: {
          createdBy: 'system',
          purpose: 'general-communication'
        }
      };

      return await this.createRoom(newRoom);
    } catch (error) {
      throw new RepositoryError(
        `Failed to find or create general room for: ${repositoryPath}`,
        'findOrCreateGeneralRoom',
        'chat_rooms',
        error
      );
    }
  }

  /**
   * Delete old messages
   */
  async deleteOldMessages(roomId: string, olderThan: Date): Promise<number> {
    try {
      const result = await this.drizzle
        .delete(chatMessages)
        .where(and(
          eq(chatMessages.roomId, roomId),
          lt(chatMessages.timestamp, olderThan.toISOString())
        ))
        .execute();

      return result.changes;
    } catch (error) {
      throw new RepositoryError(
        `Failed to delete old messages from room: ${roomId}`,
        'deleteOldMessages',
        'chat_messages',
        error
      );
    }
  }

  /**
   * Delete old messages by room name (backwards compatibility)
   */
  async deleteOldMessagesByName(roomName: string, olderThan: Date): Promise<number> {
    try {
      const room = await this.getRoomByName(roomName);
      if (!room) {
        return 0;
      }
      return await this.deleteOldMessages(room.id, olderThan);
    } catch (error) {
      throw new RepositoryError(
        `Failed to delete old messages by name from room: ${roomName}`,
        'deleteOldMessagesByName',
        'chat_messages',
        error
      );
    }
  }

  // =================== Participant Tracking Helpers ===================

  /**
   * Ensure an agent is tracked as a participant when they interact with a room
   */
  async ensureParticipantTracked(roomId: string, agentId: string, agentName: string): Promise<void> {
    try {
      // Check if participant already exists
      const isExisting = await this.isParticipant(roomId, agentId);
      
      if (!isExisting) {
        // Add as new participant
        await this.addParticipant({
          id: `participant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          roomId,
          agentId,
          agentName,
          status: 'active',
          metadata: { role: 'member' }
        });
      } else {
        // Update last active timestamp
        await this.updateParticipantActivity(roomId, agentId);
      }
    } catch (error) {
      // Don't throw - this is a tracking helper that shouldn't break main operations
      console.warn(`Failed to track participant ${agentId} in room ${roomId}:`, error);
    }
  }

  /**
   * Handle agent joining a room - ensures proper participant tracking
   */
  async joinRoom(roomId: string, agentId: string, agentName: string, role: 'member' | 'moderator' | 'observer' = 'member'): Promise<RoomParticipant> {
    try {
      // Check if already a participant
      const existingParticipant = await this.drizzle
        .select()
        .from(roomParticipants)
        .where(and(
          eq(roomParticipants.roomId, roomId),
          eq(roomParticipants.agentId, agentId)
        ))
        .limit(1)
        .execute();

      if (existingParticipant.length > 0) {
        // Update existing participant to active status
        const updated = await this.updateParticipant(roomId, agentId, { 
          status: 'active',
          metadata: { role }
        });
        return updated!;
      } else {
        // Add new participant
        return await this.addParticipant({
          id: `participant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          roomId,
          agentId,
          agentName,
          status: 'active',
          metadata: { role }
        });
      }
    } catch (error) {
      throw new RepositoryError(
        `Failed to join room ${roomId} for agent ${agentId}`,
        'joinRoom',
        'room_participants',
        error
      );
    }
  }

  /**
   * Handle agent leaving a room - marks as left
   */
  async leaveRoom(roomId: string, agentId: string): Promise<boolean> {
    try {
      const updated = await this.updateParticipant(roomId, agentId, { 
        status: 'left' 
      });
      return updated !== null;
    } catch (error) {
      throw new RepositoryError(
        `Failed to leave room ${roomId} for agent ${agentId}`,
        'leaveRoom',
        'room_participants',
        error
      );
    }
  }

  // =================== Room Participants Management ===================

  /**
   * Add a participant to a room
   */
  async addParticipant(data: NewRoomParticipant): Promise<RoomParticipant> {
    try {
      // Generate ID if not provided
      const participantData = { ...data };
      if (!participantData.id) {
        participantData.id = `participant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      }

      // Validate data structure
      insertRoomParticipantSchema.parse(participantData);

      const [result] = await this.drizzle
        .insert(roomParticipants)
        .values(participantData as any)
        .returning()
        .execute();

      return result as RoomParticipant;
    } catch (error) {
      throw new RepositoryError(
        `Failed to add participant ${data.agentName} to room ${data.roomId}`,
        'addParticipant',
        'room_participants',
        error
      );
    }
  }

  /**
   * Update participant status or metadata
   */
  async updateParticipant(roomId: string, agentId: string, updates: RoomParticipantUpdate): Promise<RoomParticipant | null> {
    try {
      // Always update lastActive when updating participant
      const updatesWithTimestamp = {
        ...updates,
        lastActive: new Date().toISOString(),
      };

      // Validate update structure
      updateRoomParticipantSchema.parse(updatesWithTimestamp);

      const [result] = await this.drizzle
        .update(roomParticipants)
        .set(updatesWithTimestamp as any)
        .where(and(
          eq(roomParticipants.roomId, roomId),
          eq(roomParticipants.agentId, agentId)
        ))
        .returning()
        .execute();

      return result ? (result as RoomParticipant) : null;
    } catch (error) {
      throw new RepositoryError(
        `Failed to update participant ${agentId} in room ${roomId}`,
        'updateParticipant',
        'room_participants',
        error
      );
    }
  }

  /**
   * Remove a participant from a room
   */
  async removeParticipant(roomId: string, agentId: string): Promise<boolean> {
    try {
      const result = await this.drizzle
        .delete(roomParticipants)
        .where(and(
          eq(roomParticipants.roomId, roomId),
          eq(roomParticipants.agentId, agentId)
        ))
        .execute();

      return result.changes > 0;
    } catch (error) {
      throw new RepositoryError(
        `Failed to remove participant ${agentId} from room ${roomId}`,
        'removeParticipant',
        'room_participants',
        error
      );
    }
  }

  /**
   * Get all participants in a room (from participants table)
   */
  async getRoomParticipantRecords(roomId: string): Promise<RoomParticipant[]> {
    try {
      const result = await this.drizzle
        .select()
        .from(roomParticipants)
        .where(eq(roomParticipants.roomId, roomId))
        .orderBy(asc(roomParticipants.joinedAt))
        .execute();

      return result as RoomParticipant[];
    } catch (error) {
      throw new RepositoryError(
        `Failed to get participants for room ${roomId}`,
        'getRoomParticipants',
        'room_participants',
        error
      );
    }
  }

  /**
   * Get active participants in a room
   */
  async getActiveParticipants(roomId: string): Promise<RoomParticipant[]> {
    try {
      const result = await this.drizzle
        .select()
        .from(roomParticipants)
        .where(and(
          eq(roomParticipants.roomId, roomId),
          eq(roomParticipants.status, 'active')
        ))
        .orderBy(asc(roomParticipants.joinedAt))
        .execute();

      return result as RoomParticipant[];
    } catch (error) {
      throw new RepositoryError(
        `Failed to get active participants for room ${roomId}`,
        'getActiveParticipants',
        'room_participants',
        error
      );
    }
  }

  /**
   * Get all rooms an agent is participating in
   */
  async getAgentRooms(agentId: string): Promise<RoomParticipant[]> {
    try {
      const result = await this.drizzle
        .select()
        .from(roomParticipants)
        .where(eq(roomParticipants.agentId, agentId))
        .orderBy(desc(roomParticipants.lastActive))
        .execute();

      return result as RoomParticipant[];
    } catch (error) {
      throw new RepositoryError(
        `Failed to get rooms for agent ${agentId}`,
        'getAgentRooms',
        'room_participants',
        error
      );
    }
  }

  /**
   * Check if an agent is a participant in a room
   */
  async isParticipant(roomId: string, agentId: string): Promise<boolean> {
    try {
      const result = await this.drizzle
        .select({ id: roomParticipants.id })
        .from(roomParticipants)
        .where(and(
          eq(roomParticipants.roomId, roomId),
          eq(roomParticipants.agentId, agentId)
        ))
        .limit(1)
        .execute();

      return result.length > 0;
    } catch (error) {
      throw new RepositoryError(
        `Failed to check if agent ${agentId} is participant in room ${roomId}`,
        'isParticipant',
        'room_participants',
        error
      );
    }
  }

  /**
   * Update last active timestamp for a participant
   */
  async updateParticipantActivity(roomId: string, agentId: string): Promise<void> {
    try {
      await this.drizzle
        .update(roomParticipants)
        .set({ lastActive: new Date().toISOString() })
        .where(and(
          eq(roomParticipants.roomId, roomId),
          eq(roomParticipants.agentId, agentId)
        ))
        .execute();
    } catch (error) {
      throw new RepositoryError(
        `Failed to update activity for participant ${agentId} in room ${roomId}`,
        'updateParticipantActivity',
        'room_participants',
        error
      );
    }
  }

  /**
   * Get participants with filtering options
   */
  async getParticipants(filter: ParticipantFilter): Promise<RoomParticipant[]> {
    try {
      const conditions: any[] = [];

      if (filter.roomId) {
        conditions.push(eq(roomParticipants.roomId, filter.roomId));
      }

      if (filter.agentId) {
        conditions.push(eq(roomParticipants.agentId, filter.agentId));
      }

      if (filter.agentName) {
        conditions.push(like(roomParticipants.agentName, `%${filter.agentName}%`));
      }

      if (filter.status) {
        conditions.push(eq(roomParticipants.status, filter.status));
      }

      if (filter.since) {
        conditions.push(gte(roomParticipants.joinedAt, filter.since));
      }

      if (filter.until) {
        conditions.push(lte(roomParticipants.joinedAt, filter.until));
      }

      let result;
      if (conditions.length > 0) {
        result = await this.drizzle
          .select()
          .from(roomParticipants)
          .where(and(...conditions))
          .orderBy(desc(roomParticipants.lastActive))
          .limit(filter.limit || 100)
          .offset(filter.offset || 0)
          .execute();
      } else {
        result = await this.drizzle
          .select()
          .from(roomParticipants)
          .orderBy(desc(roomParticipants.lastActive))
          .limit(filter.limit || 100)
          .offset(filter.offset || 0)
          .execute();
      }

      return result as RoomParticipant[];
    } catch (error) {
      throw new RepositoryError(
        'Failed to get participants with filter',
        'getParticipants',
        'room_participants',
        error
      );
    }
  }

  /**
   * Mark participant as left (soft delete)
   */
  async markParticipantLeft(roomId: string, agentId: string): Promise<RoomParticipant | null> {
    return await this.updateParticipant(roomId, agentId, { status: 'left' });
  }

  /**
   * Clean up old inactive participants
   */
  async cleanupInactiveParticipants(inactiveDays: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - inactiveDays);

      const result = await this.drizzle
        .delete(roomParticipants)
        .where(and(
          eq(roomParticipants.status, 'inactive'),
          lt(roomParticipants.lastActive, cutoffDate.toISOString())
        ))
        .execute();

      return result.changes;
    } catch (error) {
      throw new RepositoryError(
        `Failed to cleanup inactive participants older than ${inactiveDays} days`,
        'cleanupInactiveParticipants',
        'room_participants',
        error
      );
    }
  }

  /**
   * Get participant count for a room
   */
  async getParticipantCount(roomId: string, status?: 'active' | 'inactive' | 'left'): Promise<number> {
    try {
      const conditions = [eq(roomParticipants.roomId, roomId)];
      
      if (status) {
        conditions.push(eq(roomParticipants.status, status));
      }

      const result = await this.drizzle
        .select({ count: sql`count(*)`.as('count') })
        .from(roomParticipants)
        .where(and(...conditions))
        .execute();

      return Number(result[0]?.count || 0);
    } catch (error) {
      throw new RepositoryError(
        `Failed to get participant count for room ${roomId}`,
        'getParticipantCount',
        'room_participants',
        error
      );
    }
  }

  /**
   * Bulk update participant status for a room
   */
  async bulkUpdateParticipantStatus(roomId: string, fromStatus: string, toStatus: string): Promise<number> {
    try {
      const result = await this.drizzle
        .update(roomParticipants)
        .set({ 
          status: toStatus as any,
          lastActive: new Date().toISOString() 
        })
        .where(and(
          eq(roomParticipants.roomId, roomId),
          eq(roomParticipants.status, fromStatus as any)
        ))
        .execute();

      return result.changes;
    } catch (error) {
      throw new RepositoryError(
        `Failed to bulk update participants from ${fromStatus} to ${toStatus} in room ${roomId}`,
        'bulkUpdateParticipantStatus',
        'room_participants',
        error
      );
    }
  }

  // =================== Stale Room Detection Methods ===================

  /**
   * Find stale rooms based on inactivity criteria
   */
  async findStaleRooms(options: {
    inactiveMinutes?: number;
    noActiveParticipants?: boolean;
    noRecentMessages?: boolean;
    emptyRooms?: boolean;
    gracePeriodMinutes?: number;
    maxResults?: number;
    preserveGeneralRooms?: boolean;
  } = {}): Promise<Array<{
    room: ChatRoom;
    lastActivity: string | null;
    activeParticipantCount: number;
    totalParticipantCount: number;
    messageCount: number;
    staleness: {
      noActiveParticipants: boolean;
      noRecentMessages: boolean;
      isEmpty: boolean;
      isInactive: boolean;
    };
  }>> {
    try {
      const {
        inactiveMinutes = 60,
        noActiveParticipants = true,
        noRecentMessages = true,
        emptyRooms = true,
        gracePeriodMinutes = 10,
        maxResults = 50,
        preserveGeneralRooms = false
      } = options;

      // Calculate cutoff time for inactivity
      const inactiveCutoff = new Date();
      inactiveCutoff.setMinutes(inactiveCutoff.getMinutes() - inactiveMinutes);
      const inactiveCutoffStr = inactiveCutoff.toISOString();

      // Calculate grace period cutoff (recently created rooms)
      const gracePeriodCutoff = new Date();
      gracePeriodCutoff.setMinutes(gracePeriodCutoff.getMinutes() - gracePeriodMinutes);
      const gracePeriodCutoffStr = gracePeriodCutoff.toISOString();

      // Get all rooms
      const allRooms = await this.drizzle
        .select()
        .from(chatRooms)
        .orderBy(desc(chatRooms.createdAt))
        .execute();

      const staleRooms = [];

      for (const room of allRooms) {
        // Skip rooms in grace period (recently created)
        if (room.createdAt > gracePeriodCutoffStr) {
          continue;
        }

        // Skip general rooms if preservation is enabled
        if (preserveGeneralRooms && room.isGeneral) {
          continue;
        }

        // Get active participant count
        const activeParticipants = await this.getParticipantCount(room.id, 'active');
        const totalParticipants = await this.getParticipantCount(room.id);
        const messageCount = await this.getMessageCount(room.id);

        // Get last activity (most recent between last message and last participant activity)
        const lastMessageResult = await this.drizzle
          .select({ timestamp: chatMessages.timestamp })
          .from(chatMessages)
          .where(eq(chatMessages.roomId, room.id))
          .orderBy(desc(chatMessages.timestamp))
          .limit(1)
          .execute();

        const lastParticipantActivityResult = await this.drizzle
          .select({ lastActive: roomParticipants.lastActive })
          .from(roomParticipants)
          .where(eq(roomParticipants.roomId, room.id))
          .orderBy(desc(roomParticipants.lastActive))
          .limit(1)
          .execute();

        const lastMessageTime = lastMessageResult[0]?.timestamp || null;
        const lastParticipantActivity = lastParticipantActivityResult[0]?.lastActive || null;

        // Determine the most recent activity
        let lastActivity: string | null = null;
        if (lastMessageTime && lastParticipantActivity) {
          lastActivity = lastMessageTime > lastParticipantActivity ? lastMessageTime : lastParticipantActivity;
        } else if (lastMessageTime) {
          lastActivity = lastMessageTime;
        } else if (lastParticipantActivity) {
          lastActivity = lastParticipantActivity;
        }

        // Determine staleness criteria
        const staleness = {
          noActiveParticipants: activeParticipants === 0,
          noRecentMessages: !lastActivity || lastActivity < inactiveCutoffStr,
          isEmpty: messageCount === 0 && totalParticipants === 0,
          isInactive: !lastActivity || lastActivity < inactiveCutoffStr
        };

        // Check if room meets staleness criteria
        const isStale = (
          (noActiveParticipants && staleness.noActiveParticipants) ||
          (noRecentMessages && staleness.noRecentMessages) ||
          (emptyRooms && staleness.isEmpty)
        );

        if (isStale) {
          staleRooms.push({
            room,
            lastActivity,
            activeParticipantCount: activeParticipants,
            totalParticipantCount: totalParticipants,
            messageCount,
            staleness
          });

          // Respect maxResults limit
          if (maxResults && staleRooms.length >= maxResults) {
            break;
          }
        }
      }

      return staleRooms;
    } catch (error) {
      throw new RepositoryError(
        'Failed to find stale rooms',
        'findStaleRooms',
        'chat_rooms',
        error
      );
    }
  }

  /**
   * Get room activity statistics
   */
  async getRoomActivityStats(roomId: string): Promise<{
    room: ChatRoom | null;
    activeParticipants: number;
    totalParticipants: number;
    messageCount: number;
    lastMessageTime: string | null;
    lastParticipantActivity: string | null;
    lastActivity: string | null;
  }> {
    try {
      const room = await this.getRoomById(roomId);
      if (!room) {
        return {
          room: null,
          activeParticipants: 0,
          totalParticipants: 0,
          messageCount: 0,
          lastMessageTime: null,
          lastParticipantActivity: null,
          lastActivity: null
        };
      }

      const activeParticipants = await this.getParticipantCount(roomId, 'active');
      const totalParticipants = await this.getParticipantCount(roomId);
      const messageCount = await this.getMessageCount(roomId);

      // Get last message timestamp
      const lastMessageResult = await this.drizzle
        .select({ timestamp: chatMessages.timestamp })
        .from(chatMessages)
        .where(eq(chatMessages.roomId, roomId))
        .orderBy(desc(chatMessages.timestamp))
        .limit(1)
        .execute();

      // Get last participant activity
      const lastParticipantActivityResult = await this.drizzle
        .select({ lastActive: roomParticipants.lastActive })
        .from(roomParticipants)
        .where(eq(roomParticipants.roomId, roomId))
        .orderBy(desc(roomParticipants.lastActive))
        .limit(1)
        .execute();

      const lastMessageTime = lastMessageResult[0]?.timestamp || null;
      const lastParticipantActivity = lastParticipantActivityResult[0]?.lastActive || null;

      // Determine the most recent activity
      let lastActivity: string | null = null;
      if (lastMessageTime && lastParticipantActivity) {
        lastActivity = lastMessageTime > lastParticipantActivity ? lastMessageTime : lastParticipantActivity;
      } else if (lastMessageTime) {
        lastActivity = lastMessageTime;
      } else if (lastParticipantActivity) {
        lastActivity = lastParticipantActivity;
      }

      return {
        room,
        activeParticipants,
        totalParticipants,
        messageCount,
        lastMessageTime,
        lastParticipantActivity,
        lastActivity
      };
    } catch (error) {
      throw new RepositoryError(
        `Failed to get room activity stats for ${roomId}`,
        'getRoomActivityStats',
        'chat_rooms',
        error
      );
    }
  }
}