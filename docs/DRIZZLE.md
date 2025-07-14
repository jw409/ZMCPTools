# Drizzle ORM + drizzle-zod Integration Guide

## Overview

This guide documents the correct usage of Drizzle ORM with the drizzle-zod plugin for ZMCPTools, based on official documentation research.

## Core Principles

### 1. Field Naming Convention
- **TypeScript fields**: camelCase (`repositoryPath`, `agentId`, `createdAt`)
- **Database columns**: snake_case (`repository_path`, `agent_id`, `created_at`)
- **Drizzle handles mapping automatically** between these conventions

### 2. Schema as Source of Truth
- Table definitions drive everything else (queries, types, validation)
- Use drizzle-zod to generate validation schemas from table definitions
- Avoid manual schema duplication

## Table Schema Definition Pattern

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(),
  repositoryPath: text('repository_path').notNull(),  // camelCase → snake_case
  agentId: text('agent_id').notNull(),
  memoryType: text('memory_type', { 
    enum: ['insight', 'error', 'decision', 'progress', 'learning', 'pattern', 'solution'] 
  }).notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  confidence: real('confidence').notNull().default(0.8),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});
```

**Key Points:**
- TypeScript field names are camelCase
- Database column names (in quotes) are snake_case
- Drizzle automatically maps between them

## drizzle-zod Validation Schema Pattern

```typescript
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';

// Generate validation schemas from table definition
export const insertMemorySchema = createInsertSchema(memories, {
  repositoryPath: (schema) => schema.min(1),        // Refinement function
  agentId: (schema) => schema.min(1),
  title: (schema) => schema.min(1).max(200),
  content: (schema) => schema.min(1),
  confidence: (schema) => schema.min(0).max(1),
});

export const selectMemorySchema = createSelectSchema(memories);
export const updateMemorySchema = createUpdateSchema(memories);
```

**Key Points:**
- Use `createXSchema(table, refinements)` functions
- Refinements use callback functions: `(schema) => schema.constraint()`
- Field names in refinements use camelCase (matching TypeScript)

## Type Export Pattern

```typescript
// Correct: Extract TypeScript types from schemas
export type Memory = z.infer<typeof selectMemorySchema>;
export type NewMemory = z.infer<typeof insertMemorySchema>;
export type MemoryUpdate = z.infer<typeof updateMemorySchema>;

// Wrong: Don't export the schema objects as types
// export type Memory = typeof selectMemorySchema;  // ❌
```

## Schema Categories

### 1. Table Schemas (Use drizzle-zod)
- `insertXSchema` - for database inserts
- `selectXSchema` - for database selects  
- `updateXSchema` - for database updates

**Generate these with drizzle-zod, don't write manually!**

### 2. API Request Schemas (Manual z.object)
- `xFilterSchema` - for filtering/search requests
- `xRequestSchema` - for API request validation
- `xResponseSchema` - for API response validation

**These should be manual `z.object()` since they're not database tables.**

## Complete Working Example

```typescript
import { z } from 'zod';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';

// 1. Define enum schemas
export const taskTypeSchema = z.enum(['feature', 'bug_fix', 'refactor']);
export const taskStatusSchema = z.enum(['pending', 'in_progress', 'completed']);

// 2. Define table with camelCase → snake_case mapping
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  repositoryPath: text('repository_path').notNull(),
  taskType: text('task_type', { enum: ['feature', 'bug_fix', 'refactor'] }).notNull(),
  status: text('status', { enum: ['pending', 'in_progress', 'completed'] }).notNull().default('pending'),
  assignedAgentId: text('assigned_agent_id'),
  priority: integer('priority').notNull().default(0),
  description: text('description').notNull(),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
});

// 3. Generate table validation schemas with drizzle-zod
export const insertTaskSchema = createInsertSchema(tasks, {
  repositoryPath: (schema) => schema.min(1),
  description: (schema) => schema.min(1).max(2000),
  priority: (schema) => schema.int().min(-100).max(100),
});

export const selectTaskSchema = createSelectSchema(tasks);
export const updateTaskSchema = createUpdateSchema(tasks);

// 4. Export TypeScript types
export type Task = z.infer<typeof selectTaskSchema>;
export type NewTask = z.infer<typeof insertTaskSchema>;
export type TaskUpdate = z.infer<typeof updateTaskSchema>;

// 5. Manual API request schemas (NOT table schemas)
export const taskFilterSchema = z.object({
  repositoryPath: z.string().optional(),
  status: taskStatusSchema.optional(),
  assignedAgentId: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export type TaskFilter = z.infer<typeof taskFilterSchema>;
```

## Common Mistakes to Avoid

### ❌ Wrong: Manual table schemas
```typescript
// Don't do this - let drizzle-zod generate it!
export const insertTaskSchema = z.object({
  repository_path: z.string().min(1),  // Wrong field names
  task_type: taskTypeSchema,
  // ...
});
```

### ❌ Wrong: Direct Zod constraints in refinements
```typescript
export const insertTaskSchema = createInsertSchema(tasks, {
  description: z.string().min(1).max(2000),  // Wrong - not a function
});
```

### ❌ Wrong: Using typeof for type exports
```typescript
export type Task = typeof selectTaskSchema;  // Wrong - exports schema object
```

### ✅ Correct: drizzle-zod with refinement functions
```typescript
export const insertTaskSchema = createInsertSchema(tasks, {
  description: (schema) => schema.min(1).max(2000),  // Correct - refinement function
});

export type Task = z.infer<typeof selectTaskSchema>;  // Correct - extracts type
```

## Directory Structure

```
src/schemas/
├── memories.ts      # Memory table schemas
├── agents.ts        # Agent session schemas
├── tasks.ts         # Task management schemas
├── communication.ts # Chat/messaging schemas
├── scraping.ts      # Documentation scraping schemas
├── logs.ts          # Error/tool call logging schemas
└── index.ts         # Unified exports
```

## Best Practices

1. **Single Source of Truth**: Table definition drives validation schemas and types
2. **Consistent Naming**: camelCase in TypeScript, snake_case in database
3. **Separation of Concerns**: Table schemas (drizzle-zod) vs API schemas (manual)
4. **Type Safety**: Always use `z.infer<typeof schema>` for type exports
5. **Refinements**: Use callback functions for additional validation
6. **Enums**: Define once, reuse in table definitions and validations

## Debugging Tips

1. **TypeScript Errors**: Check field name consistency (camelCase vs snake_case)
2. **Validation Failures**: Verify refinement functions use callback pattern
3. **Type Issues**: Ensure using `z.infer<>` for type exports
4. **Schema Generation**: Make sure drizzle-zod imports are correct

## Migration Checklist

When updating existing schemas:

- [ ] Table uses camelCase field names with snake_case column mapping
- [ ] Table schemas use `createInsertSchema`/`createSelectSchema`/`createUpdateSchema`
- [ ] Refinements use callback functions: `(schema) => schema.constraint()`
- [ ] Type exports use `z.infer<typeof schema>`
- [ ] API request schemas remain manual `z.object()`
- [ ] All imports include necessary drizzle-zod functions
- [ ] TypeScript compilation succeeds
- [ ] Repository code uses camelCase field names