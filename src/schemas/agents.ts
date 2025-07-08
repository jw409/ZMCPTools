import { z } from 'zod';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';

// Zod v4 schemas for validation
export const agentStatusSchema = z.enum([
  'active',
  'idle', 
  'completed',
  'terminated',
  'failed',
  'initializing'
]);

export const agentCapabilitiesSchema = z.array(z.string()).default([]);
export const agentMetadataSchema = z.record(z.string(), z.unknown()).optional();

// Drizzle table definition
export const agentSessions = sqliteTable('agent_sessions', {
  id: text('id').primaryKey(),
  agentName: text('agentName').notNull(),
  repositoryPath: text('repositoryPath').notNull(),
  status: text('status', { enum: ['active', 'idle', 'completed', 'terminated', 'failed', 'initializing'] }).notNull().default('active'),
  claudePid: integer('claudePid'),
  capabilities: text('capabilities', { mode: 'json' }).$type<string[]>().default([]),
  createdAt: text('createdAt').notNull().default('CURRENT_TIMESTAMP'),
  lastHeartbeat: text('lastHeartbeat').notNull().default('CURRENT_TIMESTAMP'),
  agentMetadata: text('agentMetadata', { mode: 'json' }).$type<Record<string, unknown>>(),
});

// Generated table validation schemas using drizzle-zod
export const insertAgentSessionSchema = createInsertSchema(agentSessions, {
  agentName: (schema) => schema.min(1).max(200),
  repositoryPath: (schema) => schema.min(1),
});

export const selectAgentSessionSchema = createSelectSchema(agentSessions);
export const updateAgentSessionSchema = createUpdateSchema(agentSessions);

// Type exports - Simple TypeScript interfaces matching camelCase table fields
export type AgentSession = {
  id: string;
  agentName: string;
  repositoryPath: string;
  status: 'active' | 'idle' | 'completed' | 'terminated' | 'failed' | 'initializing';
  claudePid?: number;
  capabilities: string[];
  createdAt: string;
  lastHeartbeat: string;
  agentMetadata?: Record<string, unknown>;
};

export type NewAgentSession = Omit<AgentSession, 'createdAt' | 'lastHeartbeat'> & {
  createdAt?: string;
  lastHeartbeat?: string;
};

export type AgentSessionUpdate = Partial<Omit<AgentSession, 'id'>>;

export type AgentStatus = z.infer<typeof agentStatusSchema>;

// Agent filtering and search schemas
export const agentFilterSchema = z.object({
  repositoryPath: z.string().optional(),
  status: agentStatusSchema.optional(),
  agentId: z.string().optional(),
  capability: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export const agentHeartbeatSchema = z.object({
  agentId: z.string().min(1),
  status: agentStatusSchema.optional(),
  metadata: agentMetadataSchema,
});

export type AgentFilter = z.infer<typeof agentFilterSchema>;
export type AgentHeartbeat = z.infer<typeof agentHeartbeatSchema>;