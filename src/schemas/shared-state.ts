import { z } from 'zod';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';

/**
 * Shared State Schemas
 * Tables for cross-agent coordination and shared todos
 */

// Shared Todos Table
export const sharedTodos = sqliteTable('shared_todos', {
  id: text('id').primaryKey(),
  repositoryPath: text('repository_path').notNull(),
  content: text('content').notNull(),
  status: text('status').notNull(), // pending, in_progress, completed, blocked
  priority: text('priority').notNull(), // low, medium, high
  assignedAgent: text('assigned_agent'),
  dependencies: text('dependencies'), // JSON array
  artifacts: text('artifacts'), // JSON array
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`)
});

// Agent Progress Table
export const agentProgress = sqliteTable('agent_progress', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  taskId: text('task_id').notNull(),
  status: text('status').notNull(), // started, progress, completed, blocked, failed
  message: text('message').notNull(),
  progress: integer('progress'), // 0-100
  artifacts: text('artifacts'), // JSON array
  blockers: text('blockers'), // JSON array
  nextSteps: text('next_steps'), // JSON array
  timestamp: text('timestamp').default(sql`CURRENT_TIMESTAMP`)
});

// Artifact Registry Table
export const artifactRegistry = sqliteTable('artifact_registry', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  artifactPath: text('artifact_path').notNull(),
  artifactType: text('artifact_type').notNull(), // document, code, config, data
  description: text('description').notNull(),
  relatedTasks: text('related_tasks'), // JSON array
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
});

// Drizzle-zod schemas for validation
export const insertSharedTodoSchema = createInsertSchema(sharedTodos);
export const selectSharedTodoSchema = createSelectSchema(sharedTodos);

export const insertAgentProgressSchema = createInsertSchema(agentProgress);
export const selectAgentProgressSchema = createSelectSchema(agentProgress);

export const insertArtifactRegistrySchema = createInsertSchema(artifactRegistry);
export const selectArtifactRegistrySchema = createSelectSchema(artifactRegistry);

// TypeScript types - Manual definitions matching table structure
export type SharedTodo = {
  id: string;
  repositoryPath: string;
  content: string;
  status: string;
  priority: string;
  assignedAgent?: string | null;
  dependencies?: string | null;
  artifacts?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type InsertSharedTodo = Omit<SharedTodo, 'createdAt' | 'updatedAt'> & {
  createdAt?: string;
  updatedAt?: string;
};

export type AgentProgress = {
  id: string;
  agentId: string;
  taskId: string;
  status: string;
  message: string;
  progress?: number | null;
  artifacts?: string | null;
  blockers?: string | null;
  nextSteps?: string | null;
  timestamp?: string | null;
};

export type InsertAgentProgress = Omit<AgentProgress, 'timestamp'> & {
  timestamp?: string;
};

export type ArtifactRegistry = {
  id: string;
  agentId: string;
  artifactPath: string;
  artifactType: string;
  description: string;
  relatedTasks?: string | null;
  createdAt?: string | null;
};

export type InsertArtifactRegistry = Omit<ArtifactRegistry, 'createdAt'> & {
  createdAt?: string;
};
