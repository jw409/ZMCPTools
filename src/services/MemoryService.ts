import { DatabaseManager } from '../database/index.js';
import { MemoryRepository } from '../repositories/MemoryRepository.js';
import { PathUtils } from '../utils/pathUtils.js';
import { type Memory, type NewMemory, type MemoryType } from '../schemas/index.js';

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
  private memoryRepo: MemoryRepository;

  constructor(private db: DatabaseManager) {
    this.memoryRepo = new MemoryRepository(db);
  }

  // Core memory operations
  async createMemory(request: CreateMemoryRequest): Promise<Memory> {
    const memoryId = this.generateMemoryId();
    const resolvedRepositoryPath = PathUtils.resolveRepositoryPath(request.repositoryPath, 'memory creation');
    
    const newMemory: NewMemory = {
      id: memoryId,
      repositoryPath: resolvedRepositoryPath,
      agentId: request.agentId,
      memoryType: request.memoryType,
      title: request.title,
      content: request.content,
      tags: request.tags || [],
      miscData: request.metadata || {},
      confidence: 0.8,
      relevanceScore: 1.0
    };

    return await this.memoryRepo.create(newMemory);
  }

  async getMemory(memoryId: string): Promise<Memory | null> {
    return await this.memoryRepo.findById(memoryId);
  }

  async updateMemory(memoryId: string, update: UpdateMemoryRequest): Promise<void> {
    const memory = await this.getMemory(memoryId);
    if (!memory) {
      throw new Error(`Memory ${memoryId} not found`);
    }

    const updateData: any = {};
    
    if (update.title !== undefined) updateData.title = update.title;
    if (update.content !== undefined) updateData.content = update.content;
    if (update.metadata !== undefined) updateData.miscData = update.metadata;
    if (update.tags !== undefined) updateData.tags = update.tags;

    if (Object.keys(updateData).length > 0) {
      await this.memoryRepo.update(memoryId, updateData);
    }
  }

  async deleteMemory(memoryId: string): Promise<void> {
    const memory = await this.getMemory(memoryId);
    if (!memory) {
      throw new Error(`Memory ${memoryId} not found`);
    }

    await this.memoryRepo.delete(memoryId);
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

    return await this.memoryRepo.searchByContent(repositoryPath, query, {
      memoryType,
      limit
    });
  }

  async findMemoriesByAgent(agentId: string, repositoryPath?: string, limit = 100): Promise<Memory[]> {
    return await this.memoryRepo.findByAgent(agentId, repositoryPath, { limit });
  }

  async findMemoriesByType(memoryType: MemoryType, repositoryPath?: string, limit = 100): Promise<Memory[]> {
    if (!repositoryPath) {
      throw new Error('Repository path is required for memory search by type');
    }
    return await this.memoryRepo.findByRepositoryPath(repositoryPath, { memoryType, limit });
  }

  async findMemoriesByTags(tags: string[], repositoryPath?: string, limit = 100): Promise<Memory[]> {
    if (!repositoryPath) {
      throw new Error('Repository path is required for memory search by tags');
    }
    return await this.memoryRepo.findByTags(repositoryPath, tags, { limit });
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

  // Knowledge sharing between agents
  async shareMemoryWithAgent(
    memoryId: string,
    targetAgentId: string,
    note?: string
  ): Promise<Memory> {
    const originalMemory = await this.getMemory(memoryId);
    if (!originalMemory) {
      throw new Error(`Memory ${memoryId} not found`);
    }

    // Create a shared copy with reference to original
    const sharedTitle = `Shared: ${originalMemory.title}`;
    const sharedContent = note 
      ? `${note}\n\n--- Original Memory ---\n${originalMemory.content}`
      : originalMemory.content;

    return await this.createMemory({
      repositoryPath: originalMemory.repositoryPath,
      agentId: targetAgentId,
      memoryType: 'learning' as MemoryType, // Use learning instead of shared
      title: sharedTitle,
      content: sharedContent,
      tags: [...(originalMemory.tags || []), 'shared'],
      metadata: {
        originalMemoryId: memoryId,
        originalAgent: originalMemory.agentId,
        sharedAt: new Date().toISOString(),
        sharedBy: originalMemory.agentId
      }
    });
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

    const statistics = await this.memoryRepo.getStatistics(repositoryPath);
    
    // Calculate recent count (last week)
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const allMemories = await this.memoryRepo.findByRepositoryPath(repositoryPath);
    
    const recentCount = allMemories.filter(memory => memory.createdAt > oneWeekAgo).length;
    
    // Count by agent
    const byAgent: Record<string, number> = {};
    const tagCounts: Record<string, number> = {};
    
    for (const memory of allMemories) {
      byAgent[memory.agentId] = (byAgent[memory.agentId] || 0) + 1;
      
      for (const tag of memory.tags || []) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
    
    const topTags = Object.entries(tagCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      total: statistics.totalMemories,
      byType: statistics.byType,
      byAgent,
      recentCount,
      topTags
    };
  }

  // Memory maintenance
  async addTag(memoryId: string, tag: string): Promise<void> {
    const memory = await this.getMemory(memoryId);
    if (!memory) {
      throw new Error(`Memory ${memoryId} not found`);
    }
    
    const currentTags = memory.tags || [];
    if (!currentTags.includes(tag)) {
      const updatedTags = [...currentTags, tag];
      await this.memoryRepo.update(memoryId, { tags: updatedTags });
    }
  }

  async removeTag(memoryId: string, tag: string): Promise<void> {
    const memory = await this.getMemory(memoryId);
    if (!memory) {
      throw new Error(`Memory ${memoryId} not found`);
    }
    
    const currentTags = memory.tags || [];
    const updatedTags = currentTags.filter(t => t !== tag);
    await this.memoryRepo.update(memoryId, { tags: updatedTags });
  }

  async getUniqueTags(repositoryPath?: string): Promise<string[]> {
    if (!repositoryPath) {
      throw new Error('Repository path is required for getting unique tags');
    }

    const allMemories = await this.memoryRepo.findByRepositoryPath(repositoryPath);
    const allTags = new Set<string>();
    
    for (const memory of allMemories) {
      if (memory.tags) {
        memory.tags.forEach(tag => allTags.add(tag));
      }
    }
    
    return Array.from(allTags).sort();
  }

  async cleanupOldMemories(repositoryPath: string, olderThanDays = 30): Promise<number> {
    const resolvedRepositoryPath = PathUtils.resolveRepositoryPath(repositoryPath, 'cleanup old memories');
    return await this.memoryRepo.cleanup(resolvedRepositoryPath, { maxAgedays: olderThanDays });
  }

  async deleteAgentMemories(agentId: string, repositoryPath?: string): Promise<number> {
    const memories = await this.memoryRepo.findByAgent(agentId, repositoryPath);
    let deletedCount = 0;
    
    for (const memory of memories) {
      const deleted = await this.memoryRepo.delete(memory.id);
      if (deleted) {
        deletedCount++;
      }
    }
    
    return deletedCount;
  }

  // Batch operations
  async createMemoryBatch(requests: CreateMemoryRequest[]): Promise<Memory[]> {
    const results: Memory[] = [];
    
    await this.memoryRepo.transaction(async () => {
      for (const request of requests) {
        try {
          const memory = await this.createMemory(request);
          results.push(memory);
        } catch (error) {
          console.error(`Failed to create memory for ${request.agentId}:`, error);
        }
      }
    });

    return results;
  }

  // Export/Import for knowledge transfer
  async exportMemories(repositoryPath: string, options: {
    agentId?: string;
    memoryType?: MemoryType;
    tags?: string[];
    sinceDate?: Date;
  } = {}): Promise<Array<{
    id: string;
    title: string;
    content: string;
    agentId: string;
    memoryType: MemoryType;
    tags: string[];
    metadata: Record<string, any>;
    createdAt: string;
  }>> {
    let allMemories = await this.memoryRepo.findByRepositoryPath(repositoryPath);
    
    // Apply filters
    if (options.agentId) {
      allMemories = allMemories.filter((m: Memory) => m.agentId === options.agentId);
    }
    
    if (options.memoryType) {
      allMemories = allMemories.filter((m: Memory) => m.memoryType === options.memoryType);
    }
    
    if (options.tags && options.tags.length > 0) {
      allMemories = allMemories.filter((m: Memory) => 
        options.tags!.some(tag => (m.tags || []).includes(tag))
      );
    }
    
    if (options.sinceDate) {
      allMemories = allMemories.filter((m: Memory) => new Date(m.createdAt) >= options.sinceDate!);
    }

    return allMemories.map((memory: Memory) => ({
      id: memory.id,
      title: memory.title,
      content: memory.content,
      agentId: memory.agentId,
      memoryType: memory.memoryType,
      tags: memory.tags || [],
      metadata: memory.miscData || {},
      createdAt: memory.createdAt
    }));
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
}