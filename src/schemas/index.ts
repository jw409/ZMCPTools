// Export all Zod v4 + Drizzle schemas
export * from './agents.js';
export * from './communication.js';
export * from './logs.js';
export * from './memories.js';
export * from './scraping.js';
export * from './tasks.js';

// Re-export commonly used types for convenience
export type {
  // Memory types
  Memory,
  NewMemory,
  MemoryUpdate,
  MemoryType,
  MemoryCategory,
  MemorySearch,
} from './memories.js';

export type {
  // Agent types  
  AgentSession,
  NewAgentSession,
  AgentSessionUpdate,
  AgentStatus,
  AgentFilter,
  AgentHeartbeat,
} from './agents.js';

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
} from './tasks.js';

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
} from './communication.js';

export type {
  // Scraping types
  DocumentationSource,
  NewDocumentationSource,
  DocumentationSourceUpdate,
  ScrapeJob,
  NewScrapeJob,
  ScrapeJobUpdate,
  ScrapeJobEntry,
  NewScrapeJobEntry,
  SourceType,
  UpdateFrequency,
  ScrapeJobStatus,
  DocumentationStatus,
  ScrapeDocumentationRequest,
  SearchDocumentationRequest,
  ScrapeJobFilter,
} from './scraping.js';

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
} from './logs.js';

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
} from './memories.js';

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
} from './agents.js';

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
} from './tasks.js';

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
} from './communication.js';

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
  insertScrapeJobEntrySchema,
  selectScrapeJobEntrySchema,
  scrapeDocumentationRequestSchema,
  searchDocumentationRequestSchema,
  scrapeJobFilterSchema,
} from './scraping.js';

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
} from './logs.js';

// Re-export Drizzle table definitions
export { memories } from './memories.js';
export { agentSessions } from './agents.js';
export { tasks, taskDependencies } from './tasks.js';
export { chatRooms, chatMessages } from './communication.js';
export { documentationSources, scrapeJobs, scrapeJobEntries } from './scraping.js';
export { errorLogs, toolCallLogs } from './logs.js';

// Import tables and schemas for collections
import { 
  memories, 
  insertMemorySchema, 
  selectMemorySchema, 
  updateMemorySchema 
} from './memories.js';
import { 
  agentSessions, 
  insertAgentSessionSchema, 
  selectAgentSessionSchema, 
  updateAgentSessionSchema 
} from './agents.js';
import { 
  tasks, 
  taskDependencies, 
  insertTaskSchema, 
  selectTaskSchema, 
  updateTaskSchema,
  insertTaskDependencySchema,
  selectTaskDependencySchema
} from './tasks.js';
import { 
  chatRooms, 
  chatMessages, 
  insertChatRoomSchema, 
  selectChatRoomSchema, 
  updateChatRoomSchema,
  insertChatMessageSchema,
  selectChatMessageSchema
} from './communication.js';
import { 
  documentationSources, 
  scrapeJobs, 
  scrapeJobEntries,
  insertDocumentationSourceSchema,
  selectDocumentationSourceSchema,
  updateDocumentationSourceSchema,
  insertScrapeJobSchema,
  selectScrapeJobSchema,
  updateScrapeJobSchema,
  insertScrapeJobEntrySchema,
  selectScrapeJobEntrySchema
} from './scraping.js';
import { 
  errorLogs, 
  toolCallLogs,
  insertErrorLogSchema,
  selectErrorLogSchema,
  updateErrorLogSchema,
  insertToolCallLogSchema,
  selectToolCallLogSchema
} from './logs.js';

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
  scrapeJobEntries,
  
  // Log tables
  errorLogs,
  toolCallLogs,
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
  scrapeJobEntries: insertScrapeJobEntrySchema,
  errorLogs: insertErrorLogSchema,
  toolCallLogs: insertToolCallLogSchema,
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
  scrapeJobEntries: selectScrapeJobEntrySchema,
  errorLogs: selectErrorLogSchema,
  toolCallLogs: selectToolCallLogSchema,
} as const;

export const updateSchemas = {
  agentSessions: updateAgentSessionSchema,
  tasks: updateTaskSchema,
  memories: updateMemorySchema,
  chatRooms: updateChatRoomSchema,
  documentationSources: updateDocumentationSourceSchema,
  scrapeJobs: updateScrapeJobSchema,
  errorLogs: updateErrorLogSchema,
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
  DEFAULT_SCRAPE_CRAWL_DEPTH: 3,
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