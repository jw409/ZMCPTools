/**
 * Tool Request Schemas
 * Centralized input schema definitions for all MCP tools
 * These schemas are used for validation and type inference across the codebase
 */

import { z } from 'zod';
import type { TaskType, AgentStatus, MessageType, EntityType, RelationshipType } from './index.js';
import { entityTypeSchema, relationshipTypeSchema } from './knowledge-graph.js';

// ===============================================
// Agent Orchestration Tool Request Schemas
// ===============================================

export const OrchestrationObjectiveSchema = z.object({
  title: z.string(),
  objective: z.string(),
  repositoryPath: z.string(),
  foundationSessionId: z.string().optional()
});

export const SpawnAgentSchema = z.object({
  agentType: z.string(),
  repositoryPath: z.string(),
  taskDescription: z.string(),
  capabilities: z.array(z.string()).optional().default(['ALL_TOOLS']),
  dependsOn: z.array(z.string()).optional().default([]),
  metadata: z.record(z.string(), z.any()).optional().default({})
});

export const CreateTaskSchema = z.object({
  repositoryPath: z.string(),
  taskType: z.custom<TaskType>(),
  title: z.string(),
  description: z.string(),
  requirements: z.record(z.string(), z.any()).optional(),
  dependencies: z.array(z.string()).optional()
});

export const JoinRoomSchema = z.object({
  roomName: z.string(),
  agentName: z.string()
});

export const SendMessageSchema = z.object({
  roomName: z.string(),
  agentName: z.string(),
  message: z.string(),
  mentions: z.array(z.string()).optional()
});

export const WaitForMessagesSchema = z.object({
  roomName: z.string(),
  timeout: z.number().default(30000),
  sinceTimestamp: z.string().optional()
});

export const StoreMemorySchema = z.object({
  repositoryPath: z.string(),
  agentId: z.string(),
  entryType: z.custom<EntityType>(),
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()).optional()
});

export const SearchMemorySchema = z.object({
  repositoryPath: z.string(),
  queryText: z.string(),
  agentId: z.string().optional(),
  limit: z.number().default(10)
});

export const ListAgentsSchema = z.object({
  repositoryPath: z.string(),
  status: z.custom<AgentStatus>().optional(),
  limit: z.number().default(5),
  offset: z.number().default(0)
});

export const TerminateAgentSchema = z.object({
  agentIds: z.array(z.string())
});

export const CloseRoomSchema = z.object({
  roomName: z.string(),
  terminateAgents: z.boolean().default(true)
});

export const DeleteRoomSchema = z.object({
  roomName: z.string(),
  forceDelete: z.boolean().default(false)
});

export const ListRoomsSchema = z.object({
  repositoryPath: z.string(),
  status: z.enum(['active', 'closed', 'all']).optional(),
  limit: z.number().default(20),
  offset: z.number().default(0)
});

export const ListRoomMessagesSchema = z.object({
  roomName: z.string(),
  limit: z.number().default(50),
  offset: z.number().default(0),
  sinceTimestamp: z.string().optional()
});

export const MonitorAgentsSchema = z.object({
  agentId: z.string().optional(),
  orchestrationId: z.string().optional(),
  roomName: z.string().optional(),
  repositoryPath: z.string().optional(),
  monitoringMode: z.enum(['status', 'activity', 'communication', 'full']).default('status'),
  updateInterval: z.number().default(2000),
  maxDuration: z.number().default(50000),
  detailLevel: z.enum(['summary', 'detailed', 'verbose']).default('summary')
});

// ===============================================
// Progress Report Tool Request Schemas
// ===============================================

export const ReportProgressSchema = z.object({
  agentId: z.string(),
  repositoryPath: z.string(),
  progressType: z.enum(['status', 'task', 'milestone', 'error', 'completion']),
  message: z.string(),
  taskId: z.string().optional(),
  progressPercentage: z.number().optional(),
  results: z.record(z.any()).optional(),
  error: z.string().optional(),
  roomId: z.string().optional(),
  broadcastToRoom: z.boolean().optional()
});

// ===============================================
// TreeSummary Tool Request Schemas
// ===============================================

export const UpdateFileAnalysisSchema = z.object({
  filePath: z.string(),
  analysisData: z.object({
    filePath: z.string(),
    hash: z.string(),
    lastModified: z.string(),
    symbols: z.array(z.object({
      name: z.string(),
      type: z.enum(['function', 'class', 'variable', 'interface', 'type', 'enum']),
      line: z.number(),
      column: z.number(),
      accessibility: z.enum(['public', 'private', 'protected']).optional(),
      isExported: z.boolean()
    })),
    imports: z.array(z.string()),
    exports: z.array(z.string()),
    size: z.number(),
    language: z.string()
  })
});

export const RemoveFileAnalysisSchema = z.object({
  filePath: z.string()
});

export const UpdateProjectMetadataSchema = z.object({
  projectPath: z.string().optional()
});

export const GetProjectOverviewSchema = z.object({
  projectPath: z.string().optional()
});

export const CleanupStaleAnalysesSchema = z.object({
  projectPath: z.string().optional(),
  maxAgeDays: z.number().min(1).max(365).optional().default(30)
});

// ===============================================
// Analysis Tool Request Schemas
// ===============================================

export const AnalyzeProjectStructureSchema = z.object({
  project_path: z.string().default('.'),
  include_patterns: z.array(z.string()).default(['**/*']),
  exclude_patterns: z.array(z.string()).default(['node_modules/**', '.git/**', 'dist/**', 'build/**']),
  max_depth: z.number().default(10),
  generate_summary: z.boolean().default(true)
});

export const GenerateProjectSummarySchema = z.object({
  project_path: z.string().default('.'),
  include_readme: z.boolean().default(true),
  include_package_info: z.boolean().default(true),
  include_git_info: z.boolean().default(true),
  output_path: z.string().optional()
});

export const AnalyzeFileSymbolsSchema = z.object({
  file_path: z.string(),
  symbol_types: z.array(z.enum(['functions', 'classes', 'interfaces', 'types', 'variables', 'imports'])).default(['functions', 'classes'])
});

export const ListFilesSchema = z.object({
  directory: z.string().default('.'),
  recursive: z.boolean().default(false),
  include_patterns: z.array(z.string()).default(['*']),
  exclude_patterns: z.array(z.string()).default([])
});

export const FindFilesSchema = z.object({
  pattern: z.string(),
  directory: z.string().default('.'),
  case_sensitive: z.boolean().default(false),
  include_content: z.boolean().default(false)
});

export const EasyReplaceSchema = z.object({
  file_path: z.string(),
  old_text: z.string(),
  new_text: z.string(),
  fuzzy_match: z.boolean().default(true),
  backup: z.boolean().default(true)
});

export const CleanupOrphanedProjectsSchema = z.object({
  base_path: z.string().default(process.env.HOME || '.'),
  days_threshold: z.number().default(30),
  dry_run: z.boolean().default(true)
});

// ===============================================
// Browser Tool Request Schemas
// ===============================================

export const BrowserCreateSessionSchema = z.object({
  browser_type: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
  headless: z.boolean().default(true),
  viewport_width: z.number().default(1920),
  viewport_height: z.number().default(1080),
  user_agent: z.string().optional(),
  agent_id: z.string().optional(),
  auto_close: z.boolean().default(true),
  workflow_type: z.enum(['documentation', 'automation', 'testing']).default('automation'),
  session_timeout: z.number().default(30 * 60 * 1000), // 30 minutes
  max_idle_time: z.number().default(10 * 60 * 1000) // 10 minutes
});

export const BrowserNavigateAndScrapeSchema = z.object({
  session_id: z.string().optional(),
  url: z.string().url(),
  wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).default('domcontentloaded'),
  timeout: z.number().default(30000),
  extract_text: z.boolean().default(true),
  extract_html: z.boolean().default(false),
  extract_links: z.boolean().default(false),
  extract_images: z.boolean().default(false),
  selector: z.string().optional(),
  wait_for_selector: z.string().optional(),
  auto_create_session: z.boolean().default(true),
  browser_type: z.enum(['chromium', 'firefox', 'webkit']).default('chromium')
});

export const BrowserInteractWithPageSchema = z.object({
  session_id: z.string(),
  actions: z.array(z.object({
    type: z.enum(['click', 'type', 'hover', 'select', 'screenshot', 'wait', 'scroll']),
    selector: z.string().optional(),
    value: z.union([z.string(), z.array(z.string())]).optional(),
    filepath: z.string().optional(), // for screenshots
    timeout: z.number().default(10000),
    scroll_behavior: z.enum(['auto', 'smooth']).default('auto')
  })).min(1),
  auto_close_after: z.boolean().default(false)
});

export const BrowserManageSessionsSchema = z.object({
  action: z.enum(['list', 'close', 'close_all', 'cleanup_idle', 'get_status']),
  session_id: z.string().optional(),
  force_close: z.boolean().default(false),
  cleanup_criteria: z.object({
    max_idle_minutes: z.number().default(10),
    exclude_documentation: z.boolean().default(true)
  }).optional()
});

export const BrowserLegacyNavigateSchema = z.object({
  session_id: z.string(),
  url: z.string().url(),
  wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).default('domcontentloaded'),
  timeout: z.number().default(30000)
});

export const BrowserLegacyScrapeSchema = z.object({
  session_id: z.string(),
  selector: z.string().optional(),
  wait_for_selector: z.string().optional(),
  extract_text: z.boolean().default(true),
  extract_html: z.boolean().default(false),
  extract_links: z.boolean().default(false),
  extract_images: z.boolean().default(false)
});

export const BrowserScreenshotSchema = z.object({
  session_id: z.string(),
  filepath: z.string(),
  full_page: z.boolean().default(false),
  quality: z.number().min(0).max(100).optional(),
  type: z.enum(['png', 'jpeg']).default('png')
});

export const BrowserExecuteScriptSchema = z.object({
  session_id: z.string(),
  script: z.string(),
  args: z.array(z.any()).default([])
});

export const BrowserInteractSchema = z.object({
  session_id: z.string(),
  action: z.enum(['click', 'type', 'hover', 'select']),
  selector: z.string(),
  value: z.union([z.string(), z.array(z.string())]).optional()
});

// ===============================================
// Export all schemas with types
// ===============================================

// Orchestration Types
export type OrchestrationObjectiveInput = z.infer<typeof OrchestrationObjectiveSchema>;
export type SpawnAgentInput = z.infer<typeof SpawnAgentSchema>;
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type JoinRoomInput = z.infer<typeof JoinRoomSchema>;
export type SendMessageInput = z.infer<typeof SendMessageSchema>;
export type WaitForMessagesInput = z.infer<typeof WaitForMessagesSchema>;
export type StoreMemoryInput = z.infer<typeof StoreMemorySchema>;
export type SearchMemoryInput = z.infer<typeof SearchMemorySchema>;
export type ListAgentsInput = z.infer<typeof ListAgentsSchema>;
export type TerminateAgentInput = z.infer<typeof TerminateAgentSchema>;
export type CloseRoomInput = z.infer<typeof CloseRoomSchema>;
export type DeleteRoomInput = z.infer<typeof DeleteRoomSchema>;
export type ListRoomsInput = z.infer<typeof ListRoomsSchema>;
export type ListRoomMessagesInput = z.infer<typeof ListRoomMessagesSchema>;
export type MonitorAgentsInput = z.infer<typeof MonitorAgentsSchema>;

// Progress Types
export type ReportProgressInput = z.infer<typeof ReportProgressSchema>;

// TreeSummary Types
export type UpdateFileAnalysisInput = z.infer<typeof UpdateFileAnalysisSchema>;
export type RemoveFileAnalysisInput = z.infer<typeof RemoveFileAnalysisSchema>;
export type UpdateProjectMetadataInput = z.infer<typeof UpdateProjectMetadataSchema>;
export type GetProjectOverviewInput = z.infer<typeof GetProjectOverviewSchema>;
export type CleanupStaleAnalysesInput = z.infer<typeof CleanupStaleAnalysesSchema>;

// Analysis Types
export type AnalyzeProjectStructureInput = z.infer<typeof AnalyzeProjectStructureSchema>;
export type GenerateProjectSummaryInput = z.infer<typeof GenerateProjectSummarySchema>;
export type AnalyzeFileSymbolsInput = z.infer<typeof AnalyzeFileSymbolsSchema>;
export type ListFilesInput = z.infer<typeof ListFilesSchema>;
export type FindFilesInput = z.infer<typeof FindFilesSchema>;
export type EasyReplaceInput = z.infer<typeof EasyReplaceSchema>;
export type CleanupOrphanedProjectsInput = z.infer<typeof CleanupOrphanedProjectsSchema>;

// Browser Types
export type BrowserCreateSessionInput = z.infer<typeof BrowserCreateSessionSchema>;
export type BrowserNavigateAndScrapeInput = z.infer<typeof BrowserNavigateAndScrapeSchema>;
export type BrowserInteractWithPageInput = z.infer<typeof BrowserInteractWithPageSchema>;
export type BrowserManageSessionsInput = z.infer<typeof BrowserManageSessionsSchema>;
export type BrowserLegacyNavigateInput = z.infer<typeof BrowserLegacyNavigateSchema>;
export type BrowserLegacyScrapeInput = z.infer<typeof BrowserLegacyScrapeSchema>;
export type BrowserScreenshotInput = z.infer<typeof BrowserScreenshotSchema>;
export type BrowserExecuteScriptInput = z.infer<typeof BrowserExecuteScriptSchema>;
export type BrowserInteractInput = z.infer<typeof BrowserInteractSchema>;

// ===============================================
// Knowledge Graph Tool Request Schemas
// ===============================================

export const StoreKnowledgeMemorySchema = z.object({
  repository_path: z.string().min(1),
  agent_id: z.string().min(1),
  entity_type: entityTypeSchema,
  entity_name: z.string().min(1),
  entity_description: z.string().optional(),
  importance_score: z.number().min(0).max(1).default(0.5),
  confidence_score: z.number().min(0).max(1).default(0.7),
  properties: z.record(z.string(), z.unknown()).optional()
});

export const CreateRelationshipSchema = z.object({
  repository_path: z.string().min(1),
  from_entity_id: z.string().min(1),
  to_entity_id: z.string().min(1),
  relationship_type: relationshipTypeSchema,
  strength: z.number().min(0).max(1).default(0.7),
  confidence: z.number().min(0).max(1).default(0.7),
  context: z.string().optional(),
  discovered_by: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional()
});

export const SearchKnowledgeGraphSchema = z.object({
  repository_path: z.string().min(1),
  query: z.string().min(1),
  entity_types: z.array(entityTypeSchema).optional(),
  relationship_types: z.array(relationshipTypeSchema).optional(),
  use_semantic_search: z.boolean().default(true),
  include_relationships: z.boolean().default(true),
  limit: z.number().int().min(1).max(100).default(20),
  threshold: z.number().min(0).max(1).default(0.7)
});

export const FindRelatedEntitiesSchema = z.object({
  repository_path: z.string().min(1),
  entity_id: z.string().min(1),
  relationship_types: z.array(relationshipTypeSchema).optional(),
  max_distance: z.number().int().min(1).max(5).default(2),
  min_strength: z.number().min(0).max(1).default(0.5)
});

// Knowledge Graph Types
export type StoreKnowledgeMemoryInput = z.infer<typeof StoreKnowledgeMemorySchema>;
export type CreateRelationshipInput = z.infer<typeof CreateRelationshipSchema>;
export type SearchKnowledgeGraphInput = z.infer<typeof SearchKnowledgeGraphSchema>;
export type FindRelatedEntitiesInput = z.infer<typeof FindRelatedEntitiesSchema>;
