// Export all Zod v4 + Drizzle schemas
export * from './agents';
export * from './communication';
export * from './logs';
export * from './memories';
export * from './scraping';
export * from './tasks';
export * from './knowledge-graph';

// Re-export commonly used types for convenience
export type {
  // Memory types
  Memory,
  NewMemory,
  MemoryUpdate,
  MemoryType,
  MemoryCategory,
  MemorySearch,
} from './memories';

export type {
  // Agent types  
  AgentSession,
  NewAgentSession,
  AgentSessionUpdate,
  AgentStatus,
  AgentFilter,
  AgentHeartbeat,
} from './agents';

export type {
  // Task types
  Task,
  NewTask,
  TaskUpdate,
  TaskDependency,
  NewTaskDependency,
  TaskType,
  TaskStatus,
  DependencyType,
  TaskFilter,
  TaskCreateRequest,
} from './tasks';

export type {
  // Communication types
  ChatRoom,
  NewChatRoom,
  ChatRoomUpdate,
  ChatMessage,
  NewChatMessage,
  MessageType,
  MessageFilter,
  RoomJoinRequest,
  SendMessageRequest,
  WaitForMessagesRequest,
} from './communication';

export type {
  // Scraping types
  DocumentationSource,
  NewDocumentationSource,
  DocumentationSourceUpdate,
  ScrapeJob,
  NewScrapeJob,
  ScrapeJobUpdate,
  Website,
  NewWebsite,
  WebsiteUpdate,
  WebsitePage,
  NewWebsitePage,
  WebsitePageUpdate,
  SourceType,
  UpdateFrequency,
  ScrapeJobStatus,
  DocumentationStatus,
  ScrapeDocumentationRequest,
  SearchDocumentationRequest,
  ScrapeJobFilter,
} from './scraping';

export type {
  // Log types
  ErrorLog,
  NewErrorLog,
  ErrorLogUpdate,
  ToolCallLog,
  NewToolCallLog,
  ErrorType,
  ErrorCategory,
  ResolutionStatus,
  Severity,
  ToolCallStatus,
  ErrorLogFilter,
  ToolCallLogFilter,
  LogErrorRequest,
  LogToolCallRequest,
} from './logs';

export type {
  // Knowledge graph types
  KnowledgeEntity,
  NewKnowledgeEntity,
  KnowledgeEntityUpdate,
  KnowledgeRelationship,
  NewKnowledgeRelationship,
  KnowledgeRelationshipUpdate,
  KnowledgeInsight,
  NewKnowledgeInsight,
  EntityType,
  RelationshipType,
  Confidence,
  KnowledgeSearch,
  EntityFilter,
  RelationshipFilter,
} from './knowledge-graph';


// Re-export schemas for validation
export {
  // Memory schemas
  memoryTypeSchema,
  memoryCategorySchema,
  memoryTagsSchema,
  memoryContextSchema,
  memoryMiscDataSchema,
  insertMemorySchema,
  selectMemorySchema,
  updateMemorySchema,
  memorySearchSchema,
} from './memories';

export {
  // Agent schemas
  agentStatusSchema,
  agentCapabilitiesSchema,
  agentMetadataSchema,
  insertAgentSessionSchema,
  selectAgentSessionSchema,
  updateAgentSessionSchema,
  agentFilterSchema,
  agentHeartbeatSchema,
} from './agents';

export {
  // Task schemas
  taskTypeSchema,
  taskStatusSchema,
  dependencyTypeSchema,
  taskRequirementsSchema,
  taskResultsSchema,
  insertTaskSchema,
  selectTaskSchema,
  updateTaskSchema,
  insertTaskDependencySchema,
  selectTaskDependencySchema,
  taskFilterSchema,
  taskCreateRequestSchema,
} from './tasks';

export {
  // Communication schemas
  messageTypeSchema,
  roomMetadataSchema,
  messageMentionsSchema,
  insertChatRoomSchema,
  selectChatRoomSchema,
  updateChatRoomSchema,
  insertChatMessageSchema,
  selectChatMessageSchema,
  messageFilterSchema,
  roomJoinRequestSchema,
  sendMessageRequestSchema,
  waitForMessagesRequestSchema,
} from './communication';

export {
  // Scraping schemas
  sourceTypeSchema,
  updateFrequencySchema,
  scrapeJobStatusSchema,
  documentationStatusSchema,
  selectorsSchema,
  allowPatternsSchema,
  ignorePatternsSchema,
  sourceMetadataSchema,
  jobDataSchema,
  resultDataSchema,
  insertDocumentationSourceSchema,
  selectDocumentationSourceSchema,
  updateDocumentationSourceSchema,
  insertScrapeJobSchema,
  selectScrapeJobSchema,
  updateScrapeJobSchema,
  insertWebsiteSchema,
  selectWebsiteSchema,
  updateWebsiteSchema,
  insertWebsitePageSchema,
  selectWebsitePageSchema,
  updateWebsitePageSchema,
  scrapeDocumentationRequestSchema,
  searchDocumentationRequestSchema,
  scrapeJobFilterSchema,
} from './scraping';

export {
  // Log schemas
  errorTypeSchema,
  errorCategorySchema,
  resolutionStatusSchema,
  severitySchema,
  toolCallStatusSchema,
  errorContextSchema,
  errorEnvironmentSchema,
  toolParametersSchema,
  toolResultSchema,
  insertErrorLogSchema,
  selectErrorLogSchema,
  updateErrorLogSchema,
  insertToolCallLogSchema,
  selectToolCallLogSchema,
  errorLogFilterSchema,
  toolCallLogFilterSchema,
  logErrorRequestSchema,
  logToolCallRequestSchema,
} from './logs';

export {
  // Knowledge graph schemas
  entityTypeSchema,
  relationshipTypeSchema,
  confidenceSchema,
  entityPropertiesSchema,
  relationshipPropertiesSchema,
  insertKnowledgeEntitySchema,
  selectKnowledgeEntitySchema,
  updateKnowledgeEntitySchema,
  insertKnowledgeRelationshipSchema,
  selectKnowledgeRelationshipSchema,
  updateKnowledgeRelationshipSchema,
  insertKnowledgeInsightSchema,
  selectKnowledgeInsightSchema,
  updateKnowledgeInsightSchema,
  knowledgeSearchSchema,
  entityFilterSchema,
  relationshipFilterSchema,
} from './knowledge-graph';


// Re-export Drizzle table definitions
export { memories } from './memories';
export { agentSessions } from './agents';
export { tasks, taskDependencies } from './tasks';
export { chatRooms, chatMessages } from './communication';
export { documentationSources, scrapeJobs, websites, websitePages } from './scraping';
export { errorLogs, toolCallLogs } from './logs';
export { knowledgeEntities, knowledgeRelationships, knowledgeInsights } from './knowledge-graph';

// Import tables and schemas for collections
import { 
  memories, 
  insertMemorySchema, 
  selectMemorySchema, 
  updateMemorySchema 
} from './memories';
import { 
  agentSessions, 
  insertAgentSessionSchema, 
  selectAgentSessionSchema, 
  updateAgentSessionSchema 
} from './agents';
import { 
  tasks, 
  taskDependencies, 
  insertTaskSchema, 
  selectTaskSchema, 
  updateTaskSchema,
  insertTaskDependencySchema,
  selectTaskDependencySchema
} from './tasks';
import { 
  chatRooms, 
  chatMessages, 
  insertChatRoomSchema, 
  selectChatRoomSchema, 
  updateChatRoomSchema,
  insertChatMessageSchema,
  selectChatMessageSchema
} from './communication';
import { 
  documentationSources, 
  scrapeJobs, 
  websites,
  websitePages,
  insertDocumentationSourceSchema,
  selectDocumentationSourceSchema,
  updateDocumentationSourceSchema,
  insertScrapeJobSchema,
  selectScrapeJobSchema,
  updateScrapeJobSchema,
  insertWebsiteSchema,
  selectWebsiteSchema,
  updateWebsiteSchema,
  insertWebsitePageSchema,
  selectWebsitePageSchema,
  updateWebsitePageSchema
} from './scraping';
import { 
  errorLogs, 
  toolCallLogs,
  insertErrorLogSchema,
  selectErrorLogSchema,
  updateErrorLogSchema,
  insertToolCallLogSchema,
  selectToolCallLogSchema
} from './logs';
import {
  knowledgeEntities,
  knowledgeRelationships,
  knowledgeInsights,
  insertKnowledgeEntitySchema,
  selectKnowledgeEntitySchema,
  updateKnowledgeEntitySchema,
  insertKnowledgeRelationshipSchema,
  selectKnowledgeRelationshipSchema,
  updateKnowledgeRelationshipSchema,
  insertKnowledgeInsightSchema,
  selectKnowledgeInsightSchema,
  updateKnowledgeInsightSchema
} from './knowledge-graph';

// Database schema collections for easier management
export const allTables = {
  // Core tables
  agentSessions,
  tasks,
  taskDependencies,
  memories,
  
  
  // Communication tables  
  chatRooms,
  chatMessages,
  
  // Scraping tables
  documentationSources,
  scrapeJobs,
  websites,
  websitePages,
  
  // Log tables
  errorLogs,
  toolCallLogs,
  
  // Knowledge graph tables
  knowledgeEntities,
  knowledgeRelationships,
  knowledgeInsights,
} as const;

// Schema validation collections
export const insertSchemas = {
  agentSessions: insertAgentSessionSchema,
  tasks: insertTaskSchema,
  taskDependencies: insertTaskDependencySchema,
  memories: insertMemorySchema,
  chatRooms: insertChatRoomSchema,
  chatMessages: insertChatMessageSchema,
  documentationSources: insertDocumentationSourceSchema,
  scrapeJobs: insertScrapeJobSchema,
  websites: insertWebsiteSchema,
  websitePages: insertWebsitePageSchema,
  errorLogs: insertErrorLogSchema,
  toolCallLogs: insertToolCallLogSchema,
  knowledgeEntities: insertKnowledgeEntitySchema,
  knowledgeRelationships: insertKnowledgeRelationshipSchema,
  knowledgeInsights: insertKnowledgeInsightSchema,
} as const;

export const selectSchemas = {
  agentSessions: selectAgentSessionSchema,
  tasks: selectTaskSchema,
  taskDependencies: selectTaskDependencySchema,
  memories: selectMemorySchema,
  chatRooms: selectChatRoomSchema,
  chatMessages: selectChatMessageSchema,
  documentationSources: selectDocumentationSourceSchema,
  scrapeJobs: selectScrapeJobSchema,
  websites: selectWebsiteSchema,
  websitePages: selectWebsitePageSchema,
  errorLogs: selectErrorLogSchema,
  toolCallLogs: selectToolCallLogSchema,
  knowledgeEntities: selectKnowledgeEntitySchema,
  knowledgeRelationships: selectKnowledgeRelationshipSchema,
  knowledgeInsights: selectKnowledgeInsightSchema,
} as const;

export const updateSchemas = {
  agentSessions: updateAgentSessionSchema,
  tasks: updateTaskSchema,
  memories: updateMemorySchema,
  chatRooms: updateChatRoomSchema,
  documentationSources: updateDocumentationSourceSchema,
  scrapeJobs: updateScrapeJobSchema,
  websites: updateWebsiteSchema,
  websitePages: updateWebsitePageSchema,
  errorLogs: updateErrorLogSchema,
  knowledgeEntities: updateKnowledgeEntitySchema,
  knowledgeRelationships: updateKnowledgeRelationshipSchema,
  knowledgeInsights: updateKnowledgeInsightSchema,
} as const;

// Database constants
export const DATABASE_CONSTANTS = {
  // Default values
  DEFAULT_AGENT_STATUS: 'active' as const,
  DEFAULT_TASK_STATUS: 'pending' as const,
  DEFAULT_MEMORY_CONFIDENCE: 0.8,
  DEFAULT_MEMORY_RELEVANCE: 1.0,
  DEFAULT_MEMORY_USEFULNESS: 0.0,
  DEFAULT_MESSAGE_TYPE: 'standard' as const,
  DEFAULT_SCRAPE_MAX_PAGES: 200,
  DEFAULT_ERROR_SEVERITY: 'medium' as const,
  
  // Limits
  MAX_AGENT_NAME_LENGTH: 200,
  MAX_TASK_DESCRIPTION_LENGTH: 2000,
  MAX_MEMORY_TITLE_LENGTH: 500,
  MAX_MESSAGE_LENGTH: 4000,
  MAX_ERROR_MESSAGE_LENGTH: 2000,
  MAX_TOOL_NAME_LENGTH: 200,
  
  // Query limits
  DEFAULT_QUERY_LIMIT: 50,
  MAX_QUERY_LIMIT: 1000,
  DEFAULT_MEMORY_SEARCH_LIMIT: 10,
  MAX_MEMORY_SEARCH_LIMIT: 100,
} as const;