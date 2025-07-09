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
      chatRooms.name,
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
    return await super.create(data);
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

      if (filter.roomName) {
        conditions.push(eq(chatMessages.roomName, filter.roomName));
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
  async getMessagesSince(roomName: string, sinceTimestamp: string): Promise<ChatMessage[]> {
    try {
      const result = await this.drizzle
        .select()
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.roomName, roomName),
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
   * Delete a room and all its messages
   */
  async deleteRoom(name: string): Promise<boolean> {
    try {
      // Delete messages first
      await this.drizzle
        .delete(chatMessages)
        .where(eq(chatMessages.roomName, name))
        .execute();

      // Delete room
      const result = await this.drizzle
        .delete(chatRooms)
        .where(eq(chatRooms.name, name))
        .execute();

      return result.changes > 0;
    } catch (error) {
      throw new RepositoryError(
        `Failed to delete room: ${name}`,
        'deleteRoom',
        this.getTableName(),
        error
      );
    }
  }

  /**
   * Get room participants (unique agent names who have sent messages)
   */
  async getRoomParticipants(roomName: string): Promise<string[]> {
    try {
      const result = await this.drizzle
        .selectDistinct({ agentName: chatMessages.agentName })
        .from(chatMessages)
        .where(eq(chatMessages.roomName, roomName))
        .execute();

      return result.map(row => row.agentName);
    } catch (error) {
      throw new RepositoryError(
        `Failed to get room participants: ${roomName}`,
        'getRoomParticipants',
        'chat_messages',
        error
      );
    }
  }

  /**
   * Get message count for a room
   */
  async getMessageCount(roomName: string): Promise<number> {
    try {
      const result = await this.drizzle
        .select({ count: sql`count(*)`.as('count') })
        .from(chatMessages)
        .where(eq(chatMessages.roomName, roomName))
        .execute();

      return Number(result[0]?.count || 0);
    } catch (error) {
      throw new RepositoryError(
        `Failed to get message count: ${roomName}`,
        'getMessageCount',
        'chat_messages',
        error
      );
    }
  }

  /**
   * Get recent messages from a room
   */
  async getRecentMessages(roomName: string, limit: number = 50): Promise<ChatMessage[]> {
    try {
      const result = await this.drizzle
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.roomName, roomName))
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
        `Failed to get recent messages: ${roomName}`,
        'getRecentMessages',
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
   * Delete old messages
   */
  async deleteOldMessages(roomName: string, olderThan: Date): Promise<number> {
    try {
      const result = await this.drizzle
        .delete(chatMessages)
        .where(and(
          eq(chatMessages.roomName, roomName),
          lt(chatMessages.timestamp, olderThan.toISOString())
        ))
        .execute();

      return result.changes;
    } catch (error) {
      throw new RepositoryError(
        `Failed to delete old messages from room: ${roomName}`,
        'deleteOldMessages',
        'chat_messages',
        error
      );
    }
  }
}