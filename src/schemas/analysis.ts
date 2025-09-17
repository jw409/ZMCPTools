/**
 * Analysis Schema Definitions
 * Drizzle ORM schemas for the analysis storage system
 */

import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Context hierarchy tracking
export const contextHierarchy = sqliteTable('context_hierarchy', {
  id: integer('id').primaryKey(),
  contextPath: text('context_path').notNull().unique(),
  contextLevel: text('context_level', { enum: ['project', 'ecosystem', 'global'] }).notNull(),
  parentContextId: integer('parent_context_id').references(() => contextHierarchy.id),
  ecosystemName: text('ecosystem_name'),
  projectName: text('project_name'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  contextLevelIdx: index('idx_context_level').on(table.contextLevel),
  ecosystemIdx: index('idx_ecosystem_name').on(table.ecosystemName),
}));

// Analysis metadata tracking
export const analysisMetadata = sqliteTable('analysis_metadata', {
  id: integer('id').primaryKey(),
  projectPath: text('project_path').notNull(),
  analysisType: text('analysis_type').notNull(),
  version: text('version').default('1.0.0').notNull(),
  contextId: integer('context_id').references(() => contextHierarchy.id),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  projectAnalysisUnique: primaryKey({ columns: [table.projectPath, table.analysisType] }),
  contextIdx: index('idx_analysis_context').on(table.contextId),
}));

// File tracking for incremental updates
export const fileHashes = sqliteTable('file_hashes', {
  filePath: text('file_path').primaryKey(),
  hash: text('hash').notNull(),
  size: integer('size'),
  lastModified: text('last_modified'),
  analyzedAt: text('analyzed_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  contextId: integer('context_id').references(() => contextHierarchy.id),
}, (table) => ({
  contextIdx: index('idx_file_hashes_context').on(table.contextId),
  hashIdx: index('idx_file_hash').on(table.hash),
  modifiedIdx: index('idx_file_modified').on(table.lastModified),
}));

// Analysis runs audit log
export const analysisRuns = sqliteTable('analysis_runs', {
  id: integer('id').primaryKey(),
  startedAt: text('started_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  completedAt: text('completed_at'),
  status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull(),
  filesAnalyzed: integer('files_analyzed').default(0).notNull(),
  errors: text('errors'), // JSON array of errors
  contextId: integer('context_id').references(() => contextHierarchy.id),
}, (table) => ({
  contextIdx: index('idx_analysis_runs_context').on(table.contextId),
  statusIdx: index('idx_analysis_status').on(table.status),
  startedIdx: index('idx_analysis_started').on(table.startedAt),
}));

// Symbols tracking (functions, classes, variables, etc.)
export const symbols = sqliteTable('symbols', {
  id: integer('id').primaryKey(),
  filePath: text('file_path').notNull().references(() => fileHashes.filePath, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type', { enum: ['function', 'class', 'variable', 'interface', 'type', 'enum'] }).notNull(),
  line: integer('line').notNull(),
  column: integer('column').notNull(),
  isExported: integer('is_exported', { mode: 'boolean' }).default(false).notNull(),
  accessibility: text('accessibility', { enum: ['public', 'private', 'protected'] }),
  contextId: integer('context_id').references(() => contextHierarchy.id),
}, (table) => ({
  filePathIdx: index('idx_symbols_file_path').on(table.filePath),
  nameIdx: index('idx_symbols_name').on(table.name),
  typeIdx: index('idx_symbols_type').on(table.type),
  exportedIdx: index('idx_symbols_exported').on(table.isExported),
  contextIdx: index('idx_symbols_context').on(table.contextId),
}));

// Imports and exports tracking for dependency analysis
export const importsExports = sqliteTable('imports_exports', {
  id: integer('id').primaryKey(),
  filePath: text('file_path').notNull().references(() => fileHashes.filePath, { onDelete: 'cascade' }),
  type: text('type', { enum: ['import', 'export'] }).notNull(),
  symbolName: text('symbol_name'),
  modulePath: text('module_path'),
  isDefault: integer('is_default', { mode: 'boolean' }).default(false).notNull(),
  contextId: integer('context_id').references(() => contextHierarchy.id),
}, (table) => ({
  filePathIdx: index('idx_imports_exports_file_path').on(table.filePath),
  moduleIdx: index('idx_imports_exports_module').on(table.modulePath),
  typeIdx: index('idx_imports_exports_type').on(table.type),
  contextIdx: index('idx_imports_exports_context').on(table.contextId),
}));

// Pattern promotion tracking (for learning between contexts)
export const patternPromotion = sqliteTable('pattern_promotion', {
  id: integer('id').primaryKey(),
  patternId: integer('pattern_id'),
  sourceContextId: integer('source_context_id').references(() => contextHierarchy.id),
  targetContextId: integer('target_context_id').references(() => contextHierarchy.id),
  promotedAt: text('promoted_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  promotedBy: text('promoted_by'),
  reason: text('reason'),
}, (table) => ({
  sourceIdx: index('idx_promotion_source').on(table.sourceContextId),
  targetIdx: index('idx_promotion_target').on(table.targetContextId),
  promotedAtIdx: index('idx_promotion_date').on(table.promotedAt),
}));

// Type definitions for use in TypeScript
export type ContextHierarchy = typeof contextHierarchy.$inferSelect;
export type NewContextHierarchy = typeof contextHierarchy.$inferInsert;

export type AnalysisMetadata = typeof analysisMetadata.$inferSelect;
export type NewAnalysisMetadata = typeof analysisMetadata.$inferInsert;

export type FileHash = typeof fileHashes.$inferSelect;
export type NewFileHash = typeof fileHashes.$inferInsert;

export type AnalysisRun = typeof analysisRuns.$inferSelect;
export type NewAnalysisRun = typeof analysisRuns.$inferInsert;

export type Symbol = typeof symbols.$inferSelect;
export type NewSymbol = typeof symbols.$inferInsert;

export type ImportExport = typeof importsExports.$inferSelect;
export type NewImportExport = typeof importsExports.$inferInsert;

export type PatternPromotion = typeof patternPromotion.$inferSelect;
export type NewPatternPromotion = typeof patternPromotion.$inferInsert;