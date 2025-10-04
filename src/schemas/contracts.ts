/**
 * Contract Schema Definitions
 * Drizzle ORM schemas for contract metadata indexing
 */

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

/**
 * Contract ports table - ports from port_registry.json
 */
export const contractPorts = sqliteTable('contract_ports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  port: integer('port').notNull().unique(),
  service_name: text('service_name').notNull(),
  status: text('status').notNull(), // production, deprecated, experimental
  health_status: text('health_status'),
  description: text('description'),
  notes: text('notes'),
  schema_file: text('schema_file').notNull(), // path to contract JSON
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  portIdx: index('port_idx').on(table.port),
  statusIdx: index('port_status_idx').on(table.status),
  serviceIdx: index('port_service_idx').on(table.service_name)
}));

/**
 * Contract tools table - tools from tool_registry.json
 */
export const contractTools = sqliteTable('contract_tools', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  path: text('path').notNull(),
  purpose: text('purpose'),
  status: text('status').notNull(), // production, experimental, deprecated, unknown
  owner: text('owner'),
  trust: text('trust'), // LOW, MEDIUM, HIGH
  verified: text('verified'),
  journal_aware: integer('journal_aware', { mode: 'boolean' }).default(false),
  scope: text('scope'),
  schema_file: text('schema_file').notNull(), // path to contract JSON
  path_exists: integer('path_exists', { mode: 'boolean' }),
  path_validated_at: text('path_validated_at'),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  nameIdx: index('tool_name_idx').on(table.name),
  pathIdx: index('tool_path_idx').on(table.path),
  statusIdx: index('tool_status_idx').on(table.status),
  ownerIdx: index('tool_owner_idx').on(table.owner)
}));

/**
 * Python symbols table - extracted from AST parsing
 */
export const pythonSymbols = sqliteTable('python_symbols', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  file_path: text('file_path').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(), // function, class, variable, import
  line: integer('line').notNull(),
  col: integer('col'),
  is_exported: integer('is_exported', { mode: 'boolean' }).default(false),
  is_async: integer('is_async', { mode: 'boolean' }),
  docstring: text('docstring'),
  signature: text('signature'), // for functions: args list
  methods: text('methods'), // for classes: JSON array of method names
  bases: text('bases'), // for classes: JSON array of base classes
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  fileIdx: index('symbol_file_idx').on(table.file_path),
  nameIdx: index('symbol_name_idx').on(table.name),
  typeIdx: index('symbol_type_idx').on(table.type),
  exportedIdx: index('symbol_exported_idx').on(table.is_exported)
}));

/**
 * FTS5 virtual table for full-text search across contracts and symbols
 */
export const contractsFts = sqliteTable('contracts_fts', {
  // FTS5 virtual table - actual creation handled in migration SQL
  // This is just for TypeScript typing
  port: text('port'),
  service_name: text('service_name'),
  tool_name: text('tool_name'),
  tool_path: text('tool_path'),
  purpose: text('purpose'),
  symbol_name: text('symbol_name'),
  symbol_type: text('symbol_type'),
  content: text('content')
});

/**
 * Path validations tracking
 */
export const pathValidations = sqliteTable('path_validations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  path: text('path').notNull().unique(),
  path_exists: integer('path_exists', { mode: 'boolean' }).notNull(),
  type: text('type'), // file, directory, missing
  last_validated: text('last_validated').default(sql`CURRENT_TIMESTAMP`),
  validation_error: text('validation_error'),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`)
}, (table) => ({
  pathIdx: index('path_validation_idx').on(table.path),
  existsIdx: index('path_exists_idx').on(table.path_exists)
}));

// Type exports
export type ContractPort = typeof contractPorts.$inferSelect;
export type NewContractPort = typeof contractPorts.$inferInsert;
export type ContractTool = typeof contractTools.$inferSelect;
export type NewContractTool = typeof contractTools.$inferInsert;
export type PythonSymbol = typeof pythonSymbols.$inferSelect;
export type NewPythonSymbol = typeof pythonSymbols.$inferInsert;
export type PathValidation = typeof pathValidations.$inferSelect;
export type NewPathValidation = typeof pathValidations.$inferInsert;

// Table exports
export const contractTables = {
  contractPorts,
  contractTools,
  pythonSymbols,
  contractsFts,
  pathValidations
};
