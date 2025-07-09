/**
 * MemoryRepository - Updated to work with KnowledgeGraphService
 * This acts as a compatibility layer for existing code that expects the old memory interface
 */

import { BaseRepository, createRepositoryConfig } from './index.js';
import { DatabaseManager } from '../database/index.js';
import { KnowledgeGraphService } from '../services/KnowledgeGraphService.js';
import { VectorSearchService } from '../services/VectorSearchService.js';
import {
  memories,
  type Memory,
  type NewMemory,
  type MemoryUpdate,
  type MemoryType,
  type MemoryCategory,
  type MemorySearch,
} from '../schemas/index.js';
import { type KnowledgeEntity, type NewKnowledgeEntity, type EntityType as KnowledgeEntityType } from '../schemas/knowledge-graph.js';
import { Logger } from '../utils/logger.js';

export class MemoryRepository {
  private knowledgeGraph: KnowledgeGraphService;
  private logger: Logger;

  constructor(private drizzleManager: DatabaseManager) {
    this.logger = new Logger('memory-repository');
    
    // Initialize knowledge graph service
    const vectorService = new VectorSearchService(drizzleManager);
    this.knowledgeGraph = new KnowledgeGraphService(drizzleManager, vectorService);
  }

  /**
   * Create a new memory through knowledge graph
   */
  async create(data: NewMemory): Promise<Memory> {
    try {
      const entityType = this.mapMemoryTypeToEntityType(data.memoryType);
      
      const newEntity: NewKnowledgeEntity = {
        id: data.id || this.generateId(),
        repositoryPath: data.repositoryPath,
        entityType: entityType as any,
        name: data.title,
        description: data.content,
        properties: {
          agentId: data.agentId,
          memoryType: data.memoryType,
          category: data.category,
          tags: data.tags || [],
          confidence: data.confidence || 0.8,
          relevanceScore: data.relevanceScore || 1.0,
          usefulnessScore: data.usefulnessScore || 0.0,
          accessedCount: data.accessedCount || 0,
          referencedCount: data.referencedCount || 0,
          context: data.context,
          originalMemoryFormat: true
        },
        discoveredBy: data.agentId,
        discoveredDuring: 'memory_creation',
        confidenceScore: data.confidence || 0.8,
        relevanceScore: data.relevanceScore || 1.0,
        importanceScore: 0.5
      };

      const entity = await this.knowledgeGraph.createEntity(newEntity);
      return this.convertEntityToMemory(entity);
    } catch (error) {
      this.logger.error('Failed to create memory', error);
      throw error;
    }
  }

  /**
   * Find memory by ID
   */
  async findById(id: string): Promise<Memory | null> {
    try {
      const entity = await this.knowledgeGraph.getEntityById(id);
      return entity ? this.convertEntityToMemory(entity) : null;
    } catch (error) {
      this.logger.error('Failed to find memory by ID', { id, error });
      return null;
    }
  }

  /**
   * Update memory
   */
  async update(id: string, data: MemoryUpdate): Promise<Memory | null> {
    try {
      const updateData: any = {};
      
      if (data.title !== undefined) updateData.name = data.title;
      if (data.content !== undefined) updateData.description = data.content;
      
      // Update properties
      const currentEntity = await this.knowledgeGraph.getEntityById(id);
      if (currentEntity) {
        const currentProps = currentEntity.properties as any || {};
        updateData.properties = {
          ...currentProps,
          ...data.category && { category: data.category },
          ...data.tags && { tags: data.tags },
          ...data.confidence && { confidence: data.confidence },
          ...data.relevanceScore && { relevanceScore: data.relevanceScore },
          ...data.usefulnessScore && { usefulnessScore: data.usefulnessScore },
          ...data.accessedCount && { accessedCount: data.accessedCount },
          ...data.referencedCount && { referencedCount: data.referencedCount },
          ...data.context && { context: data.context },
          ...data.lastAccessed && { lastAccessed: data.lastAccessed }
        };
      }

      if (Object.keys(updateData).length > 0) {
        await this.knowledgeGraph.updateEntity(id, updateData);
      }

      return await this.findById(id);
    } catch (error) {
      this.logger.error('Failed to update memory', { id, error });
      throw error;
    }
  }

  /**
   * Delete memory
   */
  async delete(id: string): Promise<boolean> {
    try {
      await this.knowledgeGraph.deleteEntity(id);
      return true;
    } catch (error) {
      this.logger.error('Failed to delete memory', { id, error });
      return false;
    }
  }

  /**
   * Find memories by repository path
   */
  async findByRepositoryPath(
    repositoryPath: string,
    options: {
      memoryType?: MemoryType;
      category?: MemoryCategory;
      agentId?: string;
      minConfidence?: number;
      limit?: number;
    } = {}
  ): Promise<Memory[]> {
    try {
      let entities = await this.knowledgeGraph.findEntitiesByRepository(repositoryPath, {
        limit: options.limit || 50
      });

      // Filter by memory type
      if (options.memoryType) {
        const entityType = this.mapMemoryTypeToEntityType(options.memoryType);
        entities = entities.filter(e => e.entityType === entityType);
      }

      // Filter by agent
      if (options.agentId) {
        entities = entities.filter(e => {
          const props = e.properties as any || {};
          return props.agentId === options.agentId;
        });
      }

      // Filter by confidence
      if (options.minConfidence !== undefined) {
        entities = entities.filter(e => {
          const props = e.properties as any || {};
          return (props.confidence || 0) >= options.minConfidence!;
        });
      }

      // Filter by category
      if (options.category) {
        entities = entities.filter(e => {
          const props = e.properties as any || {};
          return props.category === options.category;
        });
      }

      return entities.map(entity => this.convertEntityToMemory(entity));
    } catch (error) {
      this.logger.error('Failed to find memories by repository path', error);
      throw error;
    }
  }

  /**
   * Search memories by content
   */
  async searchByContent(
    repositoryPath: string,
    searchTerm: string,
    options: {
      memoryType?: MemoryType;
      category?: MemoryCategory;
      minConfidence?: number;
      limit?: number;
    } = {}
  ): Promise<Memory[]> {
    try {
      const entityType = options.memoryType ? this.mapMemoryTypeToEntityType(options.memoryType) : undefined;
      const entityTypes = entityType ? [entityType] : undefined;
      
      const entities = await this.knowledgeGraph.findEntitiesBySemanticSearch(
        repositoryPath,
        searchTerm,
        entityTypes,
        options.limit || 20,
        0.5 // Lower threshold for broader results
      );

      return entities.map(entity => this.convertEntityToMemory(entity));
    } catch (error) {
      this.logger.error('Failed to search memories by content', error);
      throw error;
    }
  }

  /**
   * Find memories by tags
   */
  async findByTags(
    repositoryPath: string,
    tags: string[],
    options: {
      matchAll?: boolean;
      limit?: number;
    } = {}
  ): Promise<Memory[]> {
    try {
      const entities = await this.knowledgeGraph.findEntitiesByTags(tags, repositoryPath, options.limit || 20);
      return entities.map(entity => this.convertEntityToMemory(entity));
    } catch (error) {
      this.logger.error('Failed to find memories by tags', error);
      throw error;
    }
  }

  /**
   * Find memories by agent
   */
  async findByAgent(
    agentId: string,
    repositoryPath?: string,
    options: {
      memoryType?: MemoryType;
      includeInactive?: boolean;
      limit?: number;
    } = {}
  ): Promise<Memory[]> {
    try {
      const entities = await this.knowledgeGraph.findEntitiesByAgent(agentId, repositoryPath, options.limit || 50);
      
      // Filter by memory type if specified
      const filteredEntities = options.memoryType 
        ? entities.filter(e => e.entityType === this.mapMemoryTypeToEntityType(options.memoryType!))
        : entities;

      return filteredEntities.map(entity => this.convertEntityToMemory(entity));
    } catch (error) {
      this.logger.error('Failed to find memories by agent', error);
      throw error;
    }
  }

  /**
   * Get memory statistics
   */
  async getStatistics(repositoryPath: string): Promise<{
    totalMemories: number;
    byType: Record<MemoryType, number>;
    byCategory: Record<string, number>;
    averageConfidence: number;
    averageRelevance: number;
    averageUsefulness: number;
    mostAccessedMemory: Memory | null;
    newestMemory: Memory | null;
  }> {
    try {
      const entities = await this.knowledgeGraph.findEntitiesByRepository(repositoryPath);
      const memories = entities.map(entity => this.convertEntityToMemory(entity));
      
      const byType: Record<string, number> = {};
      const byCategory: Record<string, number> = {};
      let totalConfidence = 0;
      let totalRelevance = 0;
      let totalUsefulness = 0;
      
      let mostAccessed = memories[0] || null;
      let newest = memories[0] || null;

      for (const memory of memories) {
        // Count by type
        byType[memory.memoryType] = (byType[memory.memoryType] || 0) + 1;
        
        // Count by category
        if (memory.category) {
          byCategory[memory.category] = (byCategory[memory.category] || 0) + 1;
        }
        
        // Sum for averages
        totalConfidence += memory.confidence;
        totalRelevance += memory.relevanceScore;
        totalUsefulness += memory.usefulnessScore;
        
        // Find most accessed
        if (!mostAccessed || memory.accessedCount > mostAccessed.accessedCount) {
          mostAccessed = memory;
        }
        
        // Find newest
        if (!newest || new Date(memory.createdAt) > new Date(newest.createdAt)) {
          newest = memory;
        }
      }

      const count = memories.length;
      
      return {
        totalMemories: count,
        byType: byType as Record<MemoryType, number>,
        byCategory,
        averageConfidence: count > 0 ? totalConfidence / count : 0,
        averageRelevance: count > 0 ? totalRelevance / count : 0,
        averageUsefulness: count > 0 ? totalUsefulness / count : 0,
        mostAccessedMemory: mostAccessed,
        newestMemory: newest,
      };
    } catch (error) {
      this.logger.error('Failed to get memory statistics', error);
      throw error;
    }
  }

  /**
   * Record memory access
   */
  async recordAccess(memoryId: string): Promise<Memory | null> {
    try {
      const memory = await this.findById(memoryId);
      if (!memory) return null;

      await this.update(memoryId, {
        accessedCount: memory.accessedCount + 1,
        lastAccessed: new Date().toISOString(),
      });

      return await this.findById(memoryId);
    } catch (error) {
      this.logger.error('Failed to record memory access', { memoryId, error });
      throw error;
    }
  }

  /**
   * Helper methods
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
        return 'feature';
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

  private convertEntityToMemory(entity: KnowledgeEntity): Memory {
    const properties = entity.properties as any || {};
    
    return {
      id: entity.id,
      repositoryPath: entity.repositoryPath,
      agentId: properties.agentId || entity.discoveredBy,
      memoryType: properties.memoryType || this.mapEntityTypeToMemoryType(entity.entityType),
      title: entity.name,
      content: entity.description || '',
      category: properties.category,
      tags: properties.tags || [],
      confidence: properties.confidence || entity.confidenceScore || 0.8,
      relevanceScore: properties.relevanceScore || entity.relevanceScore || 1.0,
      usefulnessScore: properties.usefulnessScore || 0.0,
      accessedCount: properties.accessedCount || 0,
      referencedCount: properties.referencedCount || 0,
      context: properties.context,
      lastAccessed: properties.lastAccessed,
      createdAt: entity.createdAt,
      miscData: properties.metadata || {}
    };
  }

  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Legacy compatibility methods
   */
  static getValidMemoryTypes(): MemoryType[] {
    return ['insight', 'error', 'decision', 'progress', 'learning', 'pattern', 'solution'];
  }

  static isValidMemoryType(memoryType: string): memoryType is MemoryType {
    return MemoryRepository.getValidMemoryTypes().includes(memoryType as MemoryType);
  }

  // Simplified implementations for compatibility
  async getMostAccessed(repositoryPath: string, options: any = {}): Promise<Memory[]> {
    const memories = await this.findByRepositoryPath(repositoryPath, options);
    return memories.sort((a, b) => b.accessedCount - a.accessedCount).slice(0, options.limit || 20);
  }

  async getMostUseful(repositoryPath: string, options: any = {}): Promise<Memory[]> {
    const memories = await this.findByRepositoryPath(repositoryPath, options);
    return memories.sort((a, b) => b.usefulnessScore - a.usefulnessScore).slice(0, options.limit || 20);
  }

  async recordReference(memoryId: string): Promise<Memory | null> {
    const memory = await this.findById(memoryId);
    if (!memory) return null;

    await this.update(memoryId, {
      referencedCount: memory.referencedCount + 1,
    });

    return await this.findById(memoryId);
  }

  async updateUsefulnessScore(memoryId: string, newScore: number): Promise<Memory | null> {
    const clampedScore = Math.max(0, Math.min(1, newScore));
    return await this.update(memoryId, {
      usefulnessScore: clampedScore,
    });
  }

  async findRelated(memoryId: string, options: any = {}): Promise<Memory[]> {
    const memory = await this.findById(memoryId);
    if (!memory) return [];

    // Simple implementation - find by tags
    if (memory.tags && memory.tags.length > 0) {
      return await this.findByTags(memory.repositoryPath, memory.tags, {
        matchAll: false,
        limit: options.maxResults || 10
      });
    }

    return [];
  }

  async cleanup(repositoryPath: string, options: any = {}): Promise<number> {
    this.logger.info('Memory cleanup not implemented for knowledge graph backend');
    return 0;
  }

  async fixInvalidMemoryTypes(): Promise<number> {
    this.logger.info('Memory type fixing not needed for knowledge graph backend');
    return 0;
  }

  async advancedSearch(searchParams: MemorySearch): Promise<{
    memories: Memory[];
    total: number;
    hasMore: boolean;
  }> {
    const memories = await this.searchByContent(
      searchParams.repositoryPath!,
      searchParams.queryText!,
      {
        memoryType: searchParams.memoryType,
        limit: searchParams.limit || 20
      }
    );

    return {
      memories,
      total: memories.length,
      hasMore: false
    };
  }
}