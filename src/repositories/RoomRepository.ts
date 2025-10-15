import { eq, and, or, desc, gte } from 'drizzle-orm';
import { BaseRepository, createRepositoryConfig } from './index.js';
import { DatabaseManager } from '../database/index.js';
import {
  rooms,
  roomMessages,
  roomAgents,
  insertRoomSchema,
  selectRoomSchema,
  updateRoomSchema,
  insertRoomMessageSchema,
  selectRoomMessageSchema,
  insertRoomAgentSchema,
  selectRoomAgentSchema,
  type Room,
  type NewRoom,
  type RoomUpdate,
  type RoomMessage,
  type NewRoomMessage,
  type RoomAgent,
  type NewRoomAgent,
  type RoomFilter,
  type MessageFilter,
  type MessageType,
} from '../schemas/index.js';
import { nanoid } from 'nanoid';

/**
 * Repository for managing agent coordination rooms
 */
export class RoomRepository extends BaseRepository<
  typeof rooms,
  Room,
  NewRoom,
  RoomUpdate
> {
  constructor(drizzleManager: DatabaseManager) {
    super(drizzleManager, createRepositoryConfig(
      rooms,
      rooms.id,
      insertRoomSchema,
      selectRoomSchema,
      updateRoomSchema,
      'room-repository'
    ));
  }

  /**
   * Create a new room with a session ID
   */
  async createRoom(sessionId: string, task: string, repositoryPath?: string): Promise<Room> {
    const roomId = `coord-${nanoid(8)}`;

    const newRoom: NewRoom = {
      id: roomId,
      sessionId,
      task,
      repositoryPath,
      state: {},
    };

    return await this.create(newRoom);
  }

  /**
   * Find room by session ID
   */
  async findBySessionId(sessionId: string): Promise<Room | null> {
    const results = await this.query()
      .where(eq(rooms.sessionId, sessionId))
      .execute();

    return results[0] || null;
  }

  /**
   * Find rooms by repository path
   */
  async findByRepositoryPath(repositoryPath: string): Promise<Room[]> {
    return await this.query()
      .where(eq(rooms.repositoryPath, repositoryPath))
      .orderBy(rooms.createdAt, 'desc')
      .execute();
  }

  /**
   * List all active rooms with optional filtering
   */
  async listRooms(filter: RoomFilter = {}): Promise<{
    rooms: Room[];
    total: number;
    hasMore: boolean;
  }> {
    const conditions = [];

    if (filter.repositoryPath) {
      conditions.push(eq(rooms.repositoryPath, filter.repositoryPath));
    }

    if (filter.sessionId) {
      conditions.push(eq(rooms.sessionId, filter.sessionId));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

    const result = await this.list({
      where: whereClause,
      orderBy: [desc(rooms.updatedAt)],
      limit: filter.limit || 50,
      offset: filter.offset || 0,
    });

    return {
      rooms: result.data,
      total: result.total,
      hasMore: result.hasMore,
    };
  }

  /**
   * Post a message to a room
   */
  async postMessage(message: NewRoomMessage): Promise<RoomMessage> {
    try {
      const validatedMessage = insertRoomMessageSchema.parse(message);

      this.logger.debug('Posting message to room', { roomId: message.roomId, agentId: message.agentId, type: message.type });

      const result = await this.drizzleManager.transaction((tx) => {
        const inserted = tx
          .insert(roomMessages)
          .values(validatedMessage as any)
          .returning()
          .all();

        if (!inserted || inserted.length === 0) {
          throw new Error('Failed to post message to room');
        }

        // Update room's updatedAt timestamp
        tx
          .update(rooms)
          .set({ updatedAt: new Date().toISOString() })
          .where(eq(rooms.id, message.roomId))
          .run();

        return inserted[0] as RoomMessage;
      });

      this.logger.info('Message posted to room successfully', { roomId: message.roomId, messageId: result.id });
      return result;
    } catch (error) {
      this.logger.error('Failed to post message to room', { message, error });
      throw error;
    }
  }

  /**
   * Get messages from a room with optional filtering
   */
  async getMessages(filter: MessageFilter): Promise<RoomMessage[]> {
    const conditions = [eq(roomMessages.roomId, filter.roomId)];

    if (filter.agentId) {
      conditions.push(eq(roomMessages.agentId, filter.agentId));
    }

    if (filter.type) {
      conditions.push(eq(roomMessages.type, filter.type));
    }

    if (filter.sinceTimestamp) {
      conditions.push(gte(roomMessages.timestamp, filter.sinceTimestamp));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

    const results = await this.drizzle
      .select()
      .from(roomMessages)
      .where(whereClause)
      .orderBy(roomMessages.timestamp, 'asc')
      .limit(filter.limit || 100)
      .offset(filter.offset || 0);

    return results as RoomMessage[];
  }

  /**
   * Register an agent in a room
   */
  async registerAgent(agent: NewRoomAgent): Promise<RoomAgent> {
    try {
      const validatedAgent = insertRoomAgentSchema.parse(agent);

      this.logger.debug('Registering agent in room', { roomId: agent.roomId, agentId: agent.agentId });

      const result = await this.drizzle
        .insert(roomAgents)
        .values(validatedAgent as any)
        .returning()
        .all();

      if (!result || result.length === 0) {
        throw new Error('Failed to register agent in room');
      }

      this.logger.info('Agent registered in room successfully', { roomId: agent.roomId, agentId: agent.agentId });
      return result[0] as RoomAgent;
    } catch (error) {
      this.logger.error('Failed to register agent in room', { agent, error });
      throw error;
    }
  }

  /**
   * Get all agents in a room
   */
  async getAgents(roomId: string): Promise<RoomAgent[]> {
    const results = await this.drizzle
      .select()
      .from(roomAgents)
      .where(eq(roomAgents.roomId, roomId))
      .orderBy(roomAgents.joinedAt, 'asc');

    return results as RoomAgent[];
  }

  /**
   * Update room state
   */
  async updateState(roomId: string, state: Record<string, unknown>): Promise<Room | null> {
    return await this.update(roomId, {
      state,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Get room state
   */
  async getState(roomId: string): Promise<Record<string, unknown> | null> {
    const room = await this.findById(roomId);
    return room?.state || null;
  }

  /**
   * Get context summary for a room (last N messages)
   */
  async getContextSummary(roomId: string, maxMessages: number = 10): Promise<{
    room: Room | null;
    agents: RoomAgent[];
    messages: RoomMessage[];
  }> {
    const room = await this.findById(roomId);
    if (!room) {
      return { room: null, agents: [], messages: [] };
    }

    const [agents, messages] = await Promise.all([
      this.getAgents(roomId),
      this.drizzle
        .select()
        .from(roomMessages)
        .where(eq(roomMessages.roomId, roomId))
        .orderBy(desc(roomMessages.timestamp))
        .limit(maxMessages)
        .then(results => (results as RoomMessage[]).reverse())
    ]);

    return { room, agents, messages };
  }

  /**
   * Delete a room and all its messages and agents
   */
  async deleteRoom(roomId: string): Promise<boolean> {
    try {
      await this.drizzleManager.transaction((tx) => {
        // Delete messages
        tx.delete(roomMessages).where(eq(roomMessages.roomId, roomId)).run();

        // Delete agents
        tx.delete(roomAgents).where(eq(roomAgents.roomId, roomId)).run();

        // Delete room
        tx.delete(rooms).where(eq(rooms.id, roomId)).run();
      });

      this.logger.info('Room deleted successfully', { roomId });
      return true;
    } catch (error) {
      this.logger.error('Failed to delete room', { roomId, error });
      throw error;
    }
  }

  /**
   * Count messages in a room
   */
  async countMessages(roomId: string): Promise<number> {
    const result = await this.drizzle
      .select({ count: roomMessages.id })
      .from(roomMessages)
      .where(eq(roomMessages.roomId, roomId));

    return result.length;
  }

  /**
   * Get message counts by type for a room
   */
  async getMessageTypeStats(roomId: string): Promise<Record<string, number>> {
    const messages = await this.drizzle
      .select()
      .from(roomMessages)
      .where(eq(roomMessages.roomId, roomId));

    const stats: Record<string, number> = {};
    for (const message of messages) {
      stats[message.type] = (stats[message.type] || 0) + 1;
    }

    return stats;
  }
}
