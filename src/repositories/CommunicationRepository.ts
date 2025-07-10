import { eq, and, or, like, gte, lte, lt, desc, asc, sql } from 'drizzle-orm';
import { BaseRepository, createRepositoryConfig, RepositoryError } from './index.js';
import { DatabaseManager } from '../database/index.js';
import {
  chatRooms,
  chatMessages,
  insertChatRoomSchema,
  selectChatRoomSchema,
  updateChatRoomSchema,
  insertChatMessageSchema,
  selectChatMessageSchema,
  type ChatRoom,
  type NewChatRoom,
  type ChatRoomUpdate,
  type ChatMessage,
  type NewChatMessage,
  type MessageFilter,
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
      // Delete messages first
      await this.drizzle
        .delete(chatMessages)
        .where(eq(chatMessages.roomId, id))
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
   * Get room participants (unique agent names who have sent messages)
   */
  async getRoomParticipants(roomId: string): Promise<string[]> {
    try {
      const result = await this.drizzle
        .selectDistinct({ agentName: chatMessages.agentName })
        .from(chatMessages)
        .where(eq(chatMessages.roomId, roomId))
        .execute();

      return result.map(row => row.agentName);
    } catch (error) {
      throw new RepositoryError(
        `Failed to get room participants: ${roomId}`,
        'getRoomParticipants',
        'chat_messages',
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
}