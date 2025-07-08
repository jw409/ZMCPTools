import { eq, and, or, like, gte, lte, desc, asc, sql } from 'drizzle-orm';
import { BaseRepository, createRepositoryConfig, RepositoryError } from './index.js';
import { DatabaseManager } from '../database/index.js';
import {
  memories,
  insertMemorySchema,
  selectMemorySchema,
  updateMemorySchema,
  memoryTypeSchema,
  type Memory,
  type NewMemory,
  type MemoryUpdate,
  type MemoryType,
  type MemoryCategory,
  type MemorySearch,
} from '../schemas/index.js';

/**
 * Repository for managing shared memory and knowledge across agents
 */
export class MemoryRepository extends BaseRepository<
  typeof memories,
  Memory,
  NewMemory,
  MemoryUpdate
> {
  constructor(drizzleManager: DatabaseManager) {
    super(drizzleManager, createRepositoryConfig(
      memories,
      memories.id,
      insertMemorySchema,
      selectMemorySchema,
      updateMemorySchema,
      'memory-repository'
    ));
  }

  /**
   * Create a new memory with enhanced validation
   */
  async create(data: NewMemory): Promise<Memory> {
    try {
      // Validate memory_type specifically
      const validMemoryType = memoryTypeSchema.parse(data.memoryType);
      
      // Ensure the memory type is properly set
      const memoryData = {
        ...data,
        memoryType: validMemoryType,
        // Ensure required defaults are set
        confidence: data.confidence ?? 0.8,
        relevanceScore: data.relevanceScore ?? 1.0,
        usefulnessScore: data.usefulnessScore ?? 0.0,
        accessedCount: data.accessedCount ?? 0,
        referencedCount: data.referencedCount ?? 0,
        tags: data.tags ?? [],
        createdAt: data.createdAt ?? new Date().toISOString(),
      };

      return await super.create(memoryData);
    } catch (error) {
      if (error instanceof Error && error.message.includes('memory_type')) {
        this.logger.error('Memory type validation failed', { 
          providedMemoryType: data.memoryType, 
          validTypes: ['insight', 'error', 'decision', 'progress', 'learning', 'pattern', 'solution']
        });
        throw new RepositoryError(
          `Invalid memory_type: ${data.memoryType}. Must be one of: insight, error, decision, progress, learning, pattern, solution`,
          'create',
          this.table?._?.name || 'unknown-table',
          error
        );
      }
      throw error;
    }
  }


  /**
   * Find memories by repository path with optional filters
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
    const conditions = [eq(memories.repositoryPath, repositoryPath)];
    
    if (options.memoryType) {
      conditions.push(eq(memories.memoryType, options.memoryType));
    }
    
    if (options.category) {
      conditions.push(eq(memories.category, options.category));
    }
    
    if (options.agentId) {
      conditions.push(eq(memories.agentId, options.agentId));
    }
    
    if (options.minConfidence !== undefined) {
      conditions.push(gte(memories.confidence, options.minConfidence));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    return this.query()
      .where(whereClause)
      .orderBy(memories.relevanceScore, 'desc')
      .limit(options.limit || 50)
      .execute();
  }

  /**
   * Search memories by content with text matching
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
    const conditions = [
      eq(memories.repositoryPath, repositoryPath),
      or(
        like(memories.title, `%${searchTerm}%`),
        like(memories.content, `%${searchTerm}%`),
        like(memories.context, `%${searchTerm}%`)
      )
    ];
    
    if (options.memoryType) {
      conditions.push(eq(memories.memoryType, options.memoryType));
    }
    
    if (options.category) {
      conditions.push(eq(memories.category, options.category));
    }
    
    if (options.minConfidence !== undefined) {
      conditions.push(gte(memories.confidence, options.minConfidence));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    return this.query()
      .where(whereClause)
      .orderBy(memories.relevanceScore, 'desc')
      .limit(options.limit || 20)
      .execute();
  }

  /**
   * Find memories by tags
   */
  async findByTags(
    repositoryPath: string,
    tags: string[],
    options: {
      matchAll?: boolean; // true = AND, false = OR
      limit?: number;
    } = {}
  ): Promise<Memory[]> {
    // Note: This is a simplified tag search. For production, you might want to use
    // a more sophisticated approach with proper JSON operations or full-text search
    
    const allMemories = await this.findByRepositoryPath(repositoryPath, {
      limit: options.limit || 100
    });

    // Filter by tags in application code
    return allMemories.filter(memory => {
      if (!memory.tags || memory.tags.length === 0) {
        return false;
      }

      if (options.matchAll) {
        // All specified tags must be present
        return tags.every(tag => memory.tags!.includes(tag));
      } else {
        // At least one tag must be present
        return tags.some(tag => memory.tags!.includes(tag));
      }
    }).slice(0, options.limit || 20);
  }

  /**
   * Find memories by agent with activity tracking
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
    const conditions = [eq(memories.agentId, agentId)];
    
    if (repositoryPath) {
      conditions.push(eq(memories.repositoryPath, repositoryPath));
    }
    
    if (options.memoryType) {
      conditions.push(eq(memories.memoryType, options.memoryType));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    return this.query()
      .where(whereClause)
      .orderBy(memories.lastAccessed, 'desc')
      .limit(options.limit || 50)
      .execute();
  }

  /**
   * Get most accessed memories
   */
  async getMostAccessed(
    repositoryPath: string,
    options: {
      memoryType?: MemoryType;
      category?: MemoryCategory;
      minAccessCount?: number;
      limit?: number;
    } = {}
  ): Promise<Memory[]> {
    const conditions = [eq(memories.repositoryPath, repositoryPath)];
    
    if (options.memoryType) {
      conditions.push(eq(memories.memoryType, options.memoryType));
    }
    
    if (options.category) {
      conditions.push(eq(memories.category, options.category));
    }
    
    if (options.minAccessCount !== undefined) {
      conditions.push(gte(memories.accessedCount, options.minAccessCount));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    return this.query()
      .where(whereClause)
      .orderBy(memories.accessedCount, 'desc')
      .limit(options.limit || 20)
      .execute();
  }

  /**
   * Get most useful memories based on usefulness score
   */
  async getMostUseful(
    repositoryPath: string,
    options: {
      memoryType?: MemoryType;
      category?: MemoryCategory;
      minUsefulnessScore?: number;
      limit?: number;
    } = {}
  ): Promise<Memory[]> {
    const conditions = [eq(memories.repositoryPath, repositoryPath)];
    
    if (options.memoryType) {
      conditions.push(eq(memories.memoryType, options.memoryType));
    }
    
    if (options.category) {
      conditions.push(eq(memories.category, options.category));
    }
    
    if (options.minUsefulnessScore !== undefined) {
      conditions.push(gte(memories.usefulnessScore, options.minUsefulnessScore));
    }

    return this.query()
      .where(and(...conditions))
      .orderBy(memories.usefulnessScore, 'desc')
      .orderBy(memories.relevanceScore, 'desc')
      .limit(options.limit || 20)
      .execute();
  }

  /**
   * Record memory access and update metrics
   */
  async recordAccess(memoryId: string): Promise<Memory | null> {
    try {
      const memory = await this.findById(memoryId);
      if (!memory) {
        return null;
      }

      const updatedMemory = await this.update(memoryId, {
        accessedCount: memory.accessedCount + 1,
        lastAccessed: new Date().toISOString(),
      } as MemoryUpdate);

      this.logger.debug('Memory access recorded', { memoryId, newAccessCount: memory.accessedCount + 1 });
      return updatedMemory;
    } catch (error) {
      this.logger.error('Failed to record memory access', { memoryId, error });
      throw error;
    }
  }

  /**
   * Record memory reference and update metrics
   */
  async recordReference(memoryId: string): Promise<Memory | null> {
    try {
      const memory = await this.findById(memoryId);
      if (!memory) {
        return null;
      }

      const updatedMemory = await this.update(memoryId, {
        referencedCount: memory.referencedCount + 1,
      } as MemoryUpdate);

      this.logger.debug('Memory reference recorded', { memoryId, newReferenceCount: memory.referencedCount + 1 });
      return updatedMemory;
    } catch (error) {
      this.logger.error('Failed to record memory reference', { memoryId, error });
      throw error;
    }
  }

  /**
   * Update usefulness score based on feedback
   */
  async updateUsefulnessScore(memoryId: string, newScore: number): Promise<Memory | null> {
    try {
      // Clamp score between 0 and 1
      const clampedScore = Math.max(0, Math.min(1, newScore));
      
      return await this.update(memoryId, {
        usefulnessScore: clampedScore,
      } as MemoryUpdate);
    } catch (error) {
      this.logger.error('Failed to update usefulness score', { memoryId, newScore, error });
      throw error;
    }
  }

  /**
   * Find related memories based on similar tags or content
   */
  async findRelated(
    memoryId: string,
    options: {
      maxResults?: number;
      minSimilarityScore?: number;
    } = {}
  ): Promise<Memory[]> {
    const memory = await this.findById(memoryId);
    if (!memory) {
      return [];
    }

    // Simple implementation - find memories with overlapping tags or similar categories
    const relatedByTags = memory.tags && memory.tags.length > 0 
      ? await this.findByTags(memory.repositoryPath, memory.tags, { matchAll: false })
      : [];

    const relatedByCategory = memory.category
      ? await this.findByRepositoryPath(memory.repositoryPath, { category: memory.category })
      : [];

    // Combine and deduplicate
    const allRelated = [...relatedByTags, ...relatedByCategory];
    const uniqueRelated = allRelated.filter((mem, index, arr) => 
      arr.findIndex(m => m.id === mem.id) === index && mem.id !== memoryId
    );

    // Sort by relevance score and limit results
    return uniqueRelated
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, options.maxResults || 10);
  }

  /**
   * Get memory statistics for a repository
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
    const allMemories = await this.findByRepositoryPath(repositoryPath);
    
    const byType: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let totalConfidence = 0;
    let totalRelevance = 0;
    let totalUsefulness = 0;
    
    let mostAccessed = allMemories[0] || null;
    let newest = allMemories[0] || null;

    for (const memory of allMemories) {
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

    const count = allMemories.length;
    
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
  }

  /**
   * Cleanup old or low-quality memories
   */
  async cleanup(
    repositoryPath: string,
    options: {
      maxAgedays?: number;
      minUsefulnessScore?: number;
      minAccessCount?: number;
      maxMemories?: number;
    } = {}
  ): Promise<number> {
    const memories = await this.findByRepositoryPath(repositoryPath);
    const cutoffDate = options.maxAgedays 
      ? new Date(Date.now() - options.maxAgedays * 24 * 60 * 60 * 1000)
      : null;
    
    let deletedCount = 0;
    
    for (const memory of memories) {
      let shouldDelete = false;
      
      // Check age
      if (cutoffDate && new Date(memory.createdAt) < cutoffDate) {
        shouldDelete = true;
      }
      
      // Check usefulness score
      if (options.minUsefulnessScore !== undefined && 
          memory.usefulnessScore < options.minUsefulnessScore) {
        shouldDelete = true;
      }
      
      // Check access count
      if (options.minAccessCount !== undefined && 
          memory.accessedCount < options.minAccessCount) {
        shouldDelete = true;
      }
      
      if (shouldDelete) {
        const deleted = await this.delete(memory.id);
        if (deleted) {
          deletedCount++;
        }
      }
    }

    // If we have a max memories limit, delete the least useful ones
    if (options.maxMemories) {
      const remainingMemories = await this.findByRepositoryPath(repositoryPath);
      if (remainingMemories.length > options.maxMemories) {
        const toDelete = remainingMemories
          .sort((a, b) => a.usefulnessScore - b.usefulnessScore)
          .slice(0, remainingMemories.length - options.maxMemories);
        
        for (const memory of toDelete) {
          const deleted = await this.delete(memory.id);
          if (deleted) {
            deletedCount++;
          }
        }
      }
    }

    this.logger.info('Memory cleanup completed', { 
      repositoryPath, 
      deletedCount, 
      options 
    });
    
    return deletedCount;
  }

  /**
   * Get all valid memory types
   */
  static getValidMemoryTypes(): MemoryType[] {
    return ['insight', 'error', 'decision', 'progress', 'learning', 'pattern', 'solution'];
  }

  /**
   * Validate a memory type value
   */
  static isValidMemoryType(memoryType: string): memoryType is MemoryType {
    return MemoryRepository.getValidMemoryTypes().includes(memoryType as MemoryType);
  }


  /**
   * Fix any memories with invalid memory_type values
   */
  async fixInvalidMemoryTypes(): Promise<number> {
    try {
      // Get all memories
      const allMemories = await this.drizzle
        .select()
        .from(memories)
        .execute();

      let fixedCount = 0;
      const validTypes = MemoryRepository.getValidMemoryTypes();

      for (const memory of allMemories) {
        if (!MemoryRepository.isValidMemoryType(memory.memoryType)) {
          this.logger.warn('Found memory with invalid memory_type', { 
            memoryId: memory.id, 
            invalidType: memory.memoryType 
          });

          // Default to 'insight' for invalid types
          const fixedMemory = await this.update(memory.id, {
            memoryType: 'insight' as MemoryType,
          });

          if (fixedMemory) {
            fixedCount++;
            this.logger.info('Fixed invalid memory_type', { 
              memoryId: memory.id, 
              oldType: memory.memoryType, 
              newType: 'insight' 
            });
          }
        }
      }

      return fixedCount;
    } catch (error) {
      this.logger.error('Failed to fix invalid memory types', error);
      throw new RepositoryError(
        `Failed to fix invalid memory types: ${error instanceof Error ? error.message : String(error)}`,
        'fixInvalidMemoryTypes',
        this.table?._?.name || 'unknown-table',
        error
      );
    }
  }

  /**
   * Advanced search with multiple criteria
   */
  async advancedSearch(searchParams: MemorySearch): Promise<{
    memories: Memory[];
    total: number;
    hasMore: boolean;
  }> {
    const conditions = [];

    if (searchParams.repositoryPath) {
      conditions.push(eq(memories.repositoryPath, searchParams.repositoryPath));
    }

    if (searchParams.queryText) {
      conditions.push(or(
        like(memories.title, `%${searchParams.queryText}%`),
        like(memories.content, `%${searchParams.queryText}%`),
        like(memories.context, `%${searchParams.queryText}%`)
      ));
    }

    if (searchParams.memoryType) {
      conditions.push(eq(memories.memoryType, searchParams.memoryType));
    }

    if (searchParams.category) {
      conditions.push(eq(memories.category, searchParams.category));
    }

    if (searchParams.agentId) {
      conditions.push(eq(memories.agentId, searchParams.agentId));
    }

    if (searchParams.minConfidence !== undefined) {
      conditions.push(gte(memories.confidence, searchParams.minConfidence));
    }

    if (searchParams.dateRange?.from) {
      conditions.push(gte(memories.createdAt, searchParams.dateRange.from));
    }

    if (searchParams.dateRange?.to) {
      conditions.push(lte(memories.createdAt, searchParams.dateRange.to));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions.length === 1 ? conditions[0] : undefined;
    
    // Determine ordering
    let orderBy;
    switch (searchParams.sortBy) {
      case 'relevance':
        orderBy = desc(memories.relevanceScore);
        break;
      case 'usefulness':
        orderBy = desc(memories.usefulnessScore);
        break;
      case 'accessed':
        orderBy = desc(memories.accessedCount);
        break;
      case 'created':
      default:
        orderBy = desc(memories.createdAt);
        break;
    }

    const result = await this.list({
      where: whereClause,
      orderBy,
      limit: searchParams.limit,
      offset: searchParams.offset,
    });

    // Additional filtering for tags (done in application code)
    let filteredMemories = result.data;
    if (searchParams.tags && searchParams.tags.length > 0) {
      filteredMemories = filteredMemories.filter(memory =>
        memory.tags && searchParams.tags!.some(tag => memory.tags!.includes(tag))
      );
    }

    return {
      memories: filteredMemories,
      total: result.total,
      hasMore: result.hasMore,
    };
  }
}