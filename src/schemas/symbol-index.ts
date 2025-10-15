/**
 * Symbol Index Schema
 * Stores AST-parsed symbol metadata for symbol-aware BM25 search
 *
 * Enables 80% code recall (vs 60% naive BM25) by distinguishing:
 * - Files that DEFINE symbols (exports, class/function declarations)
 * - Files that only USE symbols (imports, references)
 */

import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { createId } from '@paralleldrive/cuid2';

/**
 * Symbol index entries
 * One row per file with extracted symbol metadata
 */
export const symbolIndex = sqliteTable('symbol_index', {
  id: text('id').primaryKey().$defaultFn(() => createId()),

  // File identification
  file_path: text('file_path').notNull().unique(),
  file_hash: text('file_hash', { length: 64 }).notNull(), // SHA-256 for cache invalidation

  // Symbol metadata (JSON arrays for flexibility)
  exported_symbols: text('exported_symbols').notNull(), // JSON: ["ResourceManager", "readResource"]
  defined_symbols: text('defined_symbols').notNull(),   // JSON: ["class ResourceManager", "function helper"]
  imported_symbols: text('imported_symbols').notNull(), // JSON: ["DatabaseManager", "Logger"]
  class_names: text('class_names').notNull(),           // JSON: ["ResourceManager", "CursorManager"]
  function_names: text('function_names').notNull(),     // JSON: ["readResource", "getFileResource"]

  // Metadata
  language: text('language').notNull(), // 'typescript', 'javascript', 'python'
  symbol_count: integer('symbol_count').notNull(),
  has_exports: integer('has_exports', { mode: 'boolean' }).notNull(),

  // Timestamps
  indexed_at: real('indexed_at').notNull(), // Unix timestamp
  updated_at: real('updated_at').notNull(), // Unix timestamp

  // Cache metadata
  file_size: integer('file_size').notNull(),
  parse_time_ms: integer('parse_time_ms'), // For performance monitoring
}, (table) => ({
  // Index for fast lookup by file path
  filePathIdx: index('symbol_index_file_path_idx').on(table.file_path),

  // Index for incremental updates (find stale entries)
  updatedAtIdx: index('symbol_index_updated_at_idx').on(table.updated_at),

  // Index for filtering by language
  languageIdx: index('symbol_index_language_idx').on(table.language),
}));

export type SymbolIndex = typeof symbolIndex.$inferSelect;
export type NewSymbolIndex = typeof symbolIndex.$inferInsert;

/**
 * Symbol search boosting configuration
 * Stores query-to-symbol-type weights
 */
export const symbolBoostConfig = sqliteTable('symbol_boost_config', {
  id: text('id').primaryKey().$defaultFn(() => createId()),

  // Boost weights (tuned from benchmarks)
  file_name_match_boost: real('file_name_match_boost').notNull().default(2.0),
  exported_symbol_boost: real('exported_symbol_boost').notNull().default(3.0),
  defined_symbol_boost: real('defined_symbol_boost').notNull().default(1.5),
  all_symbol_boost: real('all_symbol_boost').notNull().default(0.5),
  import_only_penalty: real('import_only_penalty').notNull().default(0.3),
  content_match_weight: real('content_match_weight').notNull().default(0.3),

  // Metadata
  config_name: text('config_name').notNull().unique(),
  description: text('description'),
  created_at: real('created_at').notNull(),
  updated_at: real('updated_at').notNull(),
}, (table) => ({
  configNameIdx: index('symbol_boost_config_name_idx').on(table.config_name),
}));

export type SymbolBoostConfig = typeof symbolBoostConfig.$inferSelect;
export type NewSymbolBoostConfig = typeof symbolBoostConfig.$inferInsert;

/**
 * Symbol indexing statistics
 * Tracks indexing performance and health
 */
export const symbolIndexStats = sqliteTable('symbol_index_stats', {
  id: text('id').primaryKey().$defaultFn(() => createId()),

  // Statistics
  total_files: integer('total_files').notNull(),
  indexed_files: integer('indexed_files').notNull(),
  failed_files: integer('failed_files').notNull(),
  avg_parse_time_ms: real('avg_parse_time_ms').notNull(),
  total_symbols: integer('total_symbols').notNull(),

  // Breakdown by language
  typescript_files: integer('typescript_files').notNull().default(0),
  javascript_files: integer('javascript_files').notNull().default(0),
  python_files: integer('python_files').notNull().default(0),

  // Performance metrics
  indexing_duration_ms: integer('indexing_duration_ms').notNull(),
  cache_hit_rate: real('cache_hit_rate').notNull(),

  // Timestamps
  started_at: real('started_at').notNull(),
  completed_at: real('completed_at').notNull(),
}, (table) => ({
  completedAtIdx: index('symbol_index_stats_completed_at_idx').on(table.completed_at),
}));

export type SymbolIndexStats = typeof symbolIndexStats.$inferSelect;
export type NewSymbolIndexStats = typeof symbolIndexStats.$inferInsert;

/**
 * Semantic embeddings metadata
 * One row per file, storing the text used for embedding and status
 */
export const semanticMetadata = sqliteTable('semantic_metadata', {
  file_path: text('file_path').primaryKey().references(() => symbolIndex.file_path, { onDelete: 'cascade' }),
  embedding_text: text('embedding_text').notNull(),
  embedding_stored: integer('embedding_stored', { mode: 'boolean' }).default(false),
  lancedb_id: text('lancedb_id'),
  total_chunks: integer('total_chunks').default(1),
});

export type SemanticMetadata = typeof semanticMetadata.$inferSelect;
export type NewSemanticMetadata = typeof semanticMetadata.$inferInsert;


/**
 * Semantic chunks for large files
 * Stores split content that exceeds the embedding model's token limit
 */
export const semanticChunks = sqliteTable('semantic_chunks', {
    chunk_id: text('chunk_id').primaryKey(),
    file_path: text('file_path').notNull().references(() => symbolIndex.file_path, { onDelete: 'cascade' }),
    chunk_index: integer('chunk_index').notNull(),
    chunk_text: text('chunk_text').notNull(),
    start_offset: integer('start_offset').notNull(),
    end_offset: integer('end_offset').notNull(),
    token_count: integer('token_count').notNull(),
    embedding_stored: integer('embedding_stored', { mode: 'boolean' }).default(false),
    lancedb_id: text('lancedb_id'),
}, (table) => ({
    filePathIdx: index('semantic_chunks_file_path_idx').on(table.file_path),
    storedIdx: index('semantic_chunks_stored_idx').on(table.embedding_stored),
}));

export type SemanticChunk = typeof semanticChunks.$inferSelect;
export type NewSemanticChunk = typeof semanticChunks.$inferInsert;