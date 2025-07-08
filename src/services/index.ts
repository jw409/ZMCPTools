// Core service exports
export { AgentService, type CreateAgentRequest, type AgentStatusUpdate } from './AgentService.js';
export { TaskService, type CreateTaskRequest, type TaskServiceUpdate, type TaskExecutionPlan } from './TaskService.js';
export { CommunicationService, type CreateRoomRequest, type CommunicationServiceMessageFilter } from './CommunicationService.js';
export { MemoryService, type CreateMemoryRequest, type UpdateMemoryRequest, type SearchOptions, type MemoryInsight } from './MemoryService.js';
export { 
  FileOperationsService, 
  fileOperationsService,
  type ListFilesOptions, 
  type FindFilesOptions, 
  type ReplaceOptions, 
  type FileInfo, 
  type ReplaceResult 
} from './FileOperationsService.js';
export { 
  TreeSummaryService,
  type ProjectOverview,
  type DirectoryNode,
  type ProjectMetadata,
  type FileAnalysis,
  type SymbolInfo,
  type UpdateOptions
} from './TreeSummaryService.js';
export { 
  FoundationCacheService, 
  type CacheEntry, 
  type FoundationSession, 
  type CacheStatistics, 
  type CacheConfig 
} from './FoundationCacheService.js';
export { 
  DocumentationService,
  type DocumentationSourceSummary
} from './DocumentationService.js';

// Repository exports
export { AgentRepository } from '../repositories/AgentRepository.js';
export { TaskRepository } from '../repositories/TaskRepository.js';
export { CommunicationRepository } from '../repositories/CommunicationRepository.js';
export { MemoryRepository } from '../repositories/MemoryRepository.js';