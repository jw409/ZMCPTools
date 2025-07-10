import { z } from 'zod';
import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';

// Zod v4 schemas for validation
export const messageTypeSchema = z.enum([
  'standard',
  'system',
  'notification',
  'alert',
  'status_update',
  'coordination',
  'error',
  'debug'
]);

export const roomMetadataSchema = z.record(z.string(), z.unknown()).optional();
export const messageMentionsSchema = z.array(z.string()).default([]);

// Drizzle table definitions
export const chatRooms = sqliteTable('chat_rooms', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  repositoryPath: text('repositoryPath').notNull(),
  isGeneral: int('isGeneral', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('createdAt').notNull().default('CURRENT_TIMESTAMP'),
  roomMetadata: text('roomMetadata', { mode: 'json' }).$type<Record<string, unknown>>(),
});

export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  roomId: text('roomId').notNull(),
  agentName: text('agentName').notNull(),
  message: text('message').notNull(),
  timestamp: text('timestamp').notNull().default('CURRENT_TIMESTAMP'),
  mentions: text('mentions', { mode: 'json' }).$type<string[]>(),
  messageType: text('messageType', { enum: ['standard', 'system', 'notification', 'alert', 'status_update', 'coordination', 'error', 'debug'] }).notNull().default('standard'),
});

// Drizzle relations
export const chatRoomsRelations = relations(chatRooms, ({ many }) => ({
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  room: one(chatRooms, {
    fields: [chatMessages.roomId],
    references: [chatRooms.id],
  }),
}));

// drizzle-zod generated schemas
export const insertChatRoomSchema = createInsertSchema(chatRooms, {
  name: (schema) => schema.min(1).max(100),
});

export const selectChatRoomSchema = createSelectSchema(chatRooms);
export const updateChatRoomSchema = createUpdateSchema(chatRooms);

export const insertChatMessageSchema = createInsertSchema(chatMessages, {
  roomId: (schema) => schema.min(1),
  agentName: (schema) => schema.min(1).max(200),
  message: (schema) => schema.min(1).max(4000),
});

export const selectChatMessageSchema = createSelectSchema(chatMessages);

// Type exports - Simple TypeScript interfaces matching camelCase table fields
export type ChatRoom = {
  id: string;
  name: string;
  description?: string;
  repositoryPath: string;
  isGeneral: boolean;
  createdAt: string;
  roomMetadata?: Record<string, unknown>;
};

export type NewChatRoom = Omit<ChatRoom, 'createdAt'> & {
  createdAt?: string;
};

export type ChatRoomUpdate = Partial<Omit<ChatRoom, 'id'>>;

export type ChatMessage = {
  id: string;
  roomId: string;
  agentName: string;
  message: string;
  timestamp: string;
  mentions?: string[];
  messageType: 'standard' | 'system' | 'notification' | 'alert' | 'status_update' | 'coordination' | 'error' | 'debug';
};

export type NewChatMessage = Omit<ChatMessage, 'timestamp'> & {
  timestamp?: string;
};

export type MessageType = z.infer<typeof messageTypeSchema>;

// Communication filtering and search schemas
export const messageFilterSchema = z.object({
  roomId: z.string().optional(),
  roomName: z.string().optional(), // Keep for backwards compatibility
  agentName: z.string().optional(),
  messageType: messageTypeSchema.optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  containsText: z.string().optional(),
  mentions: z.string().optional(),
  limit: z.number().int().min(1).max(1000).default(100),
  offset: z.number().int().min(0).default(0),
});

export const roomJoinRequestSchema = z.object({
  roomName: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  agentName: z.string().min(1).max(200),
});

export const sendMessageRequestSchema = z.object({
  roomId: z.string().min(1).optional(),
  roomName: z.string().min(1).optional(), // Keep for backwards compatibility
  agentName: z.string().min(1).max(200),
  message: z.string().min(1).max(4000),
  messageType: messageTypeSchema.default('standard'),
  mentions: messageMentionsSchema,
});

export const waitForMessagesRequestSchema = z.object({
  roomId: z.string().min(1).optional(),
  roomName: z.string().min(1).optional(), // Keep for backwards compatibility
  sinceTimestamp: z.string().datetime().optional(),
  timeout: z.number().int().min(1000).max(300000).default(30000), // 30 seconds default
  agentName: z.string().optional(), // For filtering messages
});

export type MessageFilter = z.infer<typeof messageFilterSchema>;
export type RoomJoinRequest = z.infer<typeof roomJoinRequestSchema>;
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;
export type WaitForMessagesRequest = z.infer<typeof waitForMessagesRequestSchema>;