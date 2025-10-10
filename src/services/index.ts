// Core service exports
export { EventBus, eventBus, type EventTypes, type EventListener, type EventSubscription } from './EventBus.js';
export { TaskService, type CreateTaskRequest, type TaskServiceUpdate, type TaskExecutionPlan } from './TaskService.js';
export { CommunicationService, type CreateRoomRequest, type CommunicationServiceMessageFilter } from './CommunicationService.js';
export {
  ProgressTracker,
  type ProgressContext,
  type ProgressReport,
  type AggregatedProgress
} from './ProgressTracker.js';
export { KnowledgeGraphService, type KnowledgeGraphConfig, type EntityWithRelationships, type InsightDetectionResult, type KnowledgeGraphStats } from './KnowledgeGraphService.js';
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
export {
  VectorSearchService,
  type VectorSearchConfig,
  type DocumentEmbedding,
  type SimilaritySearchResult,
  type VectorCollection
} from './VectorSearchService.js';
export {
  LanceDBService,
  type LanceDBConfig,
  type VectorDocument,
  type VectorSearchResult,
  type Collection
} from './LanceDBService.js';
export {
  TaskComplexityAnalyzer,
  type TaskComplexityAnalysis,
  type ModelType,
  type ComplexityLevel,
  type AgentSpecialization,
  type AnalysisConfig
} from './TaskComplexityAnalyzer.js';
// Over-engineered services removed - keeping only type exports for backwards compatibility
export { 
  type CoordinationStatus,
  type CoordinationEvent
} from './AlternativeCoordinationService.js';
export {
  DependencyWaitingService,
  type DependencyWaitResult,
  type TaskDependencyWaitResult,
  type CompletionEvent
} from './DependencyWaitingService.js';

// Repository exports
export { TaskRepository } from '../repositories/TaskRepository.js';
export { CommunicationRepository } from '../repositories/CommunicationRepository.js';
export { MemoryRepository } from '../repositories/MemoryRepository.js';
export { MemoryService } from './MemoryService.js';