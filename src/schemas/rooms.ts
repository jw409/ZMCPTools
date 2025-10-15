import { z } from 'zod';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';

// Zod schemas for validation
export const messageTypeSchema = z.enum([
  'orientation',
  'task_assignment',
  'acknowledgment',
  'status',
  'result',
  'coordination',
  'error',
  'completion',
  'request',
  'response',
  'final'
]);

// Drizzle table definitions
export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  sessionId: text('sessionId').notNull().unique(),
  task: text('task').notNull(),
  repositoryPath: text('repositoryPath'),
  state: text('state', { mode: 'json' }).$type<Record<string, unknown>>().default({}),
  createdAt: text('createdAt').notNull().default(sql`(current_timestamp)`),
  updatedAt: text('updatedAt').notNull().default(sql`(current_timestamp)`),
});

export const roomMessages = sqliteTable('room_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  roomId: text('roomId').notNull(),
  agentId: text('agentId').notNull(),
  type: text('type', {
    enum: ['orientation', 'task_assignment', 'acknowledgment', 'status', 'result', 'coordination', 'error', 'completion', 'request', 'response', 'final']
  }).notNull(),
  content: text('content').notNull(),
  turn: integer('turn'),
  metrics: text('metrics', { mode: 'json' }).$type<Record<string, unknown>>(),
  timestamp: text('timestamp').notNull().default(sql`(current_timestamp)`),
});

export const roomAgents = sqliteTable('room_agents', {
  roomId: text('roomId').notNull(),
  agentId: text('agentId').notNull(),
  model: text('model').notNull(),
  role: text('role').notNull(),
  joinedAt: text('joinedAt').notNull().default(sql`(current_timestamp)`),
});

// Drizzle relations
export const roomsRelations = relations(rooms, ({ many }) => ({
  messages: many(roomMessages),
  agents: many(roomAgents),
}));

export const roomMessagesRelations = relations(roomMessages, ({ one }) => ({
  room: one(rooms, {
    fields: [roomMessages.roomId],
    references: [rooms.id],
  }),
}));

export const roomAgentsRelations = relations(roomAgents, ({ one }) => ({
  room: one(rooms, {
    fields: [roomAgents.roomId],
    references: [rooms.id],
  }),
}));

// Auto-generated schemas using drizzle-zod
export const insertRoomSchema = createInsertSchema(rooms, {
  sessionId: (schema) => schema.min(1),
  task: (schema) => schema.min(1).max(1000),
});

export const selectRoomSchema = createSelectSchema(rooms);
export const updateRoomSchema = createUpdateSchema(rooms);

export const insertRoomMessageSchema = createInsertSchema(roomMessages, {
  content: (schema) => schema.min(1).max(100000),
});

export const selectRoomMessageSchema = createSelectSchema(roomMessages);

export const insertRoomAgentSchema = createInsertSchema(roomAgents);
export const selectRoomAgentSchema = createSelectSchema(roomAgents);

// Type exports
export type Room = {
  id: string;
  sessionId: string;
  task: string;
  repositoryPath?: string;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type NewRoom = Omit<Room, 'createdAt' | 'updatedAt'> & {
  createdAt?: string;
  updatedAt?: string;
};

export type RoomUpdate = Partial<Omit<Room, 'id' | 'sessionId'>>;

export type RoomMessage = {
  id: number;
  roomId: string;
  agentId: string;
  type: 'orientation' | 'task_assignment' | 'acknowledgment' | 'status' | 'result' | 'coordination' | 'error' | 'completion' | 'request' | 'response' | 'final';
  content: string;
  turn?: number;
  metrics?: Record<string, unknown>;
  timestamp: string;
};

export type NewRoomMessage = Omit<RoomMessage, 'id' | 'timestamp'> & {
  timestamp?: string;
};

export type RoomAgent = {
  roomId: string;
  agentId: string;
  model: string;
  role: string;
  joinedAt: string;
};

export type NewRoomAgent = Omit<RoomAgent, 'joinedAt'> & {
  joinedAt?: string;
};

export type MessageType = z.infer<typeof messageTypeSchema>;

// Room filtering schemas
export const roomFilterSchema = z.object({
  repositoryPath: z.string().optional(),
  sessionId: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export const messageFilterSchema = z.object({
  roomId: z.string().min(1),
  agentId: z.string().optional(),
  type: messageTypeSchema.optional(),
  sinceTimestamp: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

export type RoomFilter = z.infer<typeof roomFilterSchema>;
export type MessageFilter = z.infer<typeof messageFilterSchema>;
