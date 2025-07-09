import { DatabaseManager } from '../database/index.js';
import { KnowledgeGraphService } from './KnowledgeGraphService.js';
import { VectorSearchService } from './VectorSearchService.js';
import { PathUtils } from '../utils/pathUtils.js';
import { type Memory, type NewMemory, type MemoryType } from '../schemas/index.js';
import { type KnowledgeEntity, type NewKnowledgeEntity, type EntityType as KnowledgeEntityType } from '../schemas/knowledge-graph.js';
import { Logger } from '../utils/logger.js';
import { randomUUID } from 'crypto';

/**
 * MemoryService - Now a direct adapter over KnowledgeGraphService
 * This maintains backward compatibility while using the knowledge graph as the primary store
 */

// MemoryData interface for database operations
export interface MemoryData {
  id: string;
  repositoryPath: string;
  agentId: string;
  memoryType: MemoryType;
  title: string;
  content: string;
  metadata?: Record<string, any>;
  tags?: string[];
  createdAt?: Date;
}

export interface CreateMemoryRequest {
  repositoryPath: string;
  agentId: string;
  memoryType: MemoryType;
  title: string;
  content: string;
  metadata?: Record<string, any>;
  tags?: string[];
}

export interface UpdateMemoryRequest {
  title?: string;
  content?: string;
  metadata?: Record<string, any>;
  tags?: string[];
}

export interface SearchOptions {
  repositoryPath?: string;
  agentId?: string;
  memoryType?: MemoryType;
  tags?: string[];
  limit?: number;
  includeContent?: boolean;
}

export interface MemoryInsight {
  id: string;
  title: string;
  relevanceScore: number;
  snippet: string;
  tags: string[];
  agentId: string;
  createdAt: Date;
}

export class MemoryService {
  private knowledgeGraph: KnowledgeGraphService;
  private logger: Logger;

  constructor(private db: DatabaseManager) {
    this.logger = new Logger('memory-service');
    const vectorService = new VectorSearchService(db);
    this.knowledgeGraph = new KnowledgeGraphService(db, vectorService, {
      autoDetectInsights: true,
      semanticSearchThreshold: 0.7
    });
  }

  // Core memory operations
  async createMemory(request: CreateMemoryRequest): Promise<Memory> {
    const memoryId = this.generateMemoryId();
    const resolvedRepositoryPath = PathUtils.resolveRepositoryPath(request.repositoryPath, 'memory creation');
    
    // Map memory type to knowledge graph entity type
    const entityType: KnowledgeEntityType = this.mapMemoryTypeToEntityType(request.memoryType);
    
    const newEntity: NewKnowledgeEntity = {
      id: memoryId,
      repositoryPath: resolvedRepositoryPath,
      entityType: entityType as any,
      name: request.title,
      description: request.content,
      properties: {
        agentId: request.agentId,
        memoryType: request.memoryType,
        tags: request.tags || [],
        metadata: request.metadata || {},
        originalMemoryFormat: true
      },
      discoveredBy: request.agentId,
      discoveredDuring: 'memory_creation',
      confidenceScore: 0.8,
      relevanceScore: 1.0,
      importanceScore: 0.5
    };

    const entity = await this.knowledgeGraph.createEntity(newEntity);
    return this.convertEntityToMemory(entity);
  }

  async getMemory(memoryId: string): Promise<Memory | null> {
    try {
      const entity = await this.knowledgeGraph.getEntityById(memoryId);
      return entity ? this.convertEntityToMemory(entity) : null;
    } catch (error) {
      this.logger.error('Failed to get memory', { memoryId, error });
      return null;
    }
  }

  async updateMemory(memoryId: string, update: UpdateMemoryRequest): Promise<void> {
    const memory = await this.getMemory(memoryId);
    if (!memory) {
      throw new Error(`Memory ${memoryId} not found`);
    }

    const updateData: any = {};
    
    if (update.title !== undefined) updateData.name = update.title;
    if (update.content !== undefined) updateData.description = update.content;
    if (update.metadata !== undefined || update.tags !== undefined) {
      const currentProperties = memory.miscData || {};
      updateData.properties = {
        ...currentProperties,
        ...(update.metadata && { metadata: update.metadata }),
        ...(update.tags && { tags: update.tags })
      };
    }

    if (Object.keys(updateData).length > 0) {
      await this.knowledgeGraph.updateEntity(memoryId, updateData);
    }
  }

  async deleteMemory(memoryId: string): Promise<void> {
    const memory = await this.getMemory(memoryId);
    if (!memory) {
      throw new Error(`Memory ${memoryId} not found`);
    }

    await this.knowledgeGraph.deleteEntity(memoryId);
  }

  // Search and retrieval
  async searchMemories(query: string, options: SearchOptions = {}): Promise<Memory[]> {
    const {
      repositoryPath,
      memoryType,
      limit = 50
    } = options;

    if (!repositoryPath) {
      throw new Error('Repository path is required for memory search');
    }

    // Use semantic search from knowledge graph
    const entityType = memoryType ? this.mapMemoryTypeToEntityType(memoryType) : undefined;
    const entityTypes = entityType ? [entityType] : undefined;
    
    const entities = await this.knowledgeGraph.findEntitiesBySemanticSearch(
      repositoryPath,
      query,
      entityTypes,
      limit,
      0.5 // Lower threshold for more results
    );

    return entities.map(entity => this.convertEntityToMemory(entity));
  }

  async findMemoriesByAgent(agentId: string, repositoryPath?: string, limit = 100): Promise<Memory[]> {
    const entities = await this.knowledgeGraph.findEntitiesByAgent(agentId, repositoryPath, limit);
    return entities.map(entity => this.convertEntityToMemory(entity));
  }

  async findMemoriesByType(memoryType: MemoryType, repositoryPath?: string, limit = 100): Promise<Memory[]> {
    if (!repositoryPath) {
      throw new Error('Repository path is required for memory search by type');
    }
    const entityType = this.mapMemoryTypeToEntityType(memoryType);
    const entities = await this.knowledgeGraph.findEntitiesByType(entityType, repositoryPath, limit);
    return entities.map(entity => this.convertEntityToMemory(entity));
  }

  async findMemoriesByTags(tags: string[], repositoryPath?: string, limit = 100): Promise<Memory[]> {
    if (!repositoryPath) {
      throw new Error('Repository path is required for memory search by tags');
    }
    const entities = await this.knowledgeGraph.findEntitiesByTags(tags, repositoryPath, limit);
    return entities.map(entity => this.convertEntityToMemory(entity));
  }

  // Specialized memory types
  async storeInsight(
    repositoryPath: string,
    agentId: string,
    title: string,
    content: string,
    tags: string[] = [],
    metadata: Record<string, any> = {}
  ): Promise<Memory> {
    return await this.createMemory({
      repositoryPath,
      agentId,
      memoryType: 'insight' as MemoryType,
      title,
      content,
      tags: ['insight', ...tags],
      metadata: {
        ...metadata,
        insights: true,
        storedAt: new Date().toISOString()
      }
    });
  }

  async storeError(
    repositoryPath: string,
    agentId: string,
    error: string,
    context: Record<string, any> = {},
    tags: string[] = []
  ): Promise<Memory> {
    return await this.createMemory({
      repositoryPath,
      agentId,
      memoryType: 'error' as MemoryType,
      title: `Error: ${error.slice(0, 100)}`,
      content: error,
      tags: ['error', ...tags],
      metadata: {
        errorContext: context,
        timestamp: new Date().toISOString(),
        severity: context.severity || 'medium'
      }
    });
  }

  async storeDecision(
    repositoryPath: string,
    agentId: string,
    decision: string,
    reasoning: string,
    context: Record<string, any> = {},
    tags: string[] = []
  ): Promise<Memory> {
    return await this.createMemory({
      repositoryPath,
      agentId,
      memoryType: 'decision' as MemoryType,
      title: `Decision: ${decision}`,
      content: reasoning,
      tags: ['decision', ...tags],
      metadata: {
        decision,
        context,
        madeAt: new Date().toISOString()
      }
    });
  }

  async storeProgress(
    repositoryPath: string,
    agentId: string,
    milestone: string,
    details: string,
    metrics: Record<string, any> = {},
    tags: string[] = []
  ): Promise<Memory> {
    return await this.createMemory({
      repositoryPath,
      agentId,
      memoryType: 'progress' as MemoryType,
      title: `Progress: ${milestone}`,
      content: details,
      tags: ['progress', ...tags],
      metadata: {
        milestone,
        metrics,
        achievedAt: new Date().toISOString()
      }
    });
  }

  // Advanced search and insights
  async getRelevantMemories(
    query: string,
    repositoryPath: string,
    agentId?: string,
    limit = 10
  ): Promise<MemoryInsight[]> {
    const searchResults = await this.searchMemories(query, {
      repositoryPath,
      agentId,
      limit: limit * 2 // Get more results for ranking
    });

    // Simple relevance scoring based on query matches
    const insights: MemoryInsight[] = searchResults.map(memory => {
      const titleMatches = this.countMatches(memory.title.toLowerCase(), query.toLowerCase());
      const contentMatches = this.countMatches(memory.content.toLowerCase(), query.toLowerCase());
      const tagMatches = memory.tags.some(tag => 
        tag.toLowerCase().includes(query.toLowerCase())
      ) ? 1 : 0;

      const relevanceScore = (titleMatches * 3) + contentMatches + (tagMatches * 2);
      
      return {
        id: memory.id,
        title: memory.title,
        relevanceScore,
        snippet: this.createSnippet(memory.content, query),
        tags: memory.tags || [],
        agentId: memory.agentId,
        createdAt: new Date(memory.createdAt)
      };
    });

    // Sort by relevance score and return top results
    return insights
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }

  // Memory analytics
  async getMemoryStats(repositoryPath?: string): Promise<{
    total: number;
    byType: Record<string, number>;
    byAgent: Record<string, number>;
    recentCount: number;
    topTags: Array<{ tag: string; count: number }>;
  }> {
    if (!repositoryPath) {
      throw new Error('Repository path is required for memory stats');
    }

    const allEntities = await this.knowledgeGraph.findEntitiesByRepository(repositoryPath);
    
    // Calculate recent count (last week)
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentCount = allEntities.filter(entity => entity.createdAt > oneWeekAgo).length;
    
    // Count by type and agent
    const byType: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    const tagCounts: Record<string, number> = {};
    
    for (const entity of allEntities) {
      const memoryType = this.mapEntityTypeToMemoryType(entity.entityType);
      byType[memoryType] = (byType[memoryType] || 0) + 1;
      
      const agentId = (entity.properties as any)?.agentId || entity.discoveredBy;
      byAgent[agentId] = (byAgent[agentId] || 0) + 1;
      
      const tags = (entity.properties as any)?.tags || [];
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
    
    const topTags = Object.entries(tagCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      total: allEntities.length,
      byType,
      byAgent,
      recentCount,
      topTags
    };
  }

  // Convenience method for quick memory storage  
  async storeMemory(
    repositoryPath: string,
    agentId: string,
    memoryType: string,
    title: string,
    content: string,
    tags: string[] = []
  ): Promise<Memory> {
    // Convert string memoryType to valid type
    let type: MemoryType;
    switch (memoryType.toLowerCase()) {
      case 'insight':
        type = 'insight';
        break;
      case 'error_log':
      case 'error':
        type = 'error';
        break;
      case 'decision':
        type = 'decision';
        break;
      case 'progress':
        type = 'progress';
        break;
      case 'learning':
        type = 'learning';
        break;
      case 'pattern':
        type = 'pattern';
        break;
      case 'solution':
        type = 'solution';
        break;
      default:
        type = 'insight';
        break;
    }

    return await this.createMemory({
      repositoryPath,
      agentId,
      memoryType: type,
      title,
      content,
      tags,
      metadata: {
        storedAt: new Date().toISOString(),
        quickStore: true
      }
    });
  }

  // Utility methods
  private generateMemoryId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private countMatches(text: string, query: string): number {
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = text.match(regex);
    return matches ? matches.length : 0;
  }

  private createSnippet(content: string, query: string, maxLength = 200): string {
    const queryIndex = content.toLowerCase().indexOf(query.toLowerCase());
    
    if (queryIndex === -1) {
      return content.slice(0, maxLength) + (content.length > maxLength ? '...' : '');
    }
    
    const start = Math.max(0, queryIndex - 50);
    const end = Math.min(content.length, queryIndex + query.length + 150);
    
    let snippet = content.slice(start, end);
    
    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet = snippet + '...';
    
    return snippet;
  }

  /**
   * Convert knowledge graph entity to memory format
   */
  private convertEntityToMemory(entity: KnowledgeEntity): Memory {
    const properties = entity.properties as any || {};
    
    return {
      id: entity.id,
      repositoryPath: entity.repositoryPath,
      agentId: properties.agentId || entity.discoveredBy,
      memoryType: properties.memoryType || this.mapEntityTypeToMemoryType(entity.entityType),
      title: entity.name,
      content: entity.description || '',
      tags: properties.tags || [],
      miscData: properties.metadata || {},
      confidence: entity.confidenceScore || 0.8,
      relevanceScore: entity.relevanceScore || 1.0,
      usefulnessScore: properties.usefulnessScore || 0.0,
      accessedCount: properties.accessedCount || 0,
      referencedCount: properties.referencedCount || 0,
      createdAt: entity.createdAt
    };
  }

  /**
   * Map memory type to knowledge graph entity type
   */
  private mapMemoryTypeToEntityType(memoryType: MemoryType): KnowledgeEntityType {
    switch (memoryType) {
      case 'insight':
        return 'insight';
      case 'error':
        return 'error';
      case 'decision':
        return 'decision';
      case 'progress':
        return 'feature'; // Progress maps to feature completion
      case 'learning':
        return 'concept';
      case 'pattern':
        return 'pattern';
      case 'solution':
        return 'solution';
      default:
        return 'concept';
    }
  }

  /**
   * Map knowledge graph entity type to memory type
   */
  private mapEntityTypeToMemoryType(entityType: KnowledgeEntityType): MemoryType {
    switch (entityType) {
      case 'insight':
        return 'insight';
      case 'error':
        return 'error';
      case 'decision':
        return 'decision';
      case 'feature':
        return 'progress';
      case 'concept':
        return 'learning';
      case 'pattern':
        return 'pattern';
      case 'solution':
        return 'solution';
      default:
        return 'insight';
    }
  }
}