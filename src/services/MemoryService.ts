import { ClaudeDatabase } from '../database/index.js';
import { MemoryRepository } from './repositories/MemoryRepository.js';
import { Memory, MemoryType } from '../models/index.js';
import type { MemoryData } from '../models/index.js';

export interface CreateMemoryRequest {
  repositoryPath: string;
  agentName: string;
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
  agentName?: string;
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
  agentName: string;
  createdAt: Date;
}

export class MemoryService {
  private memoryRepo: MemoryRepository;

  constructor(private db: ClaudeDatabase) {
    this.memoryRepo = new MemoryRepository(db);
  }

  // Core memory operations
  createMemory(request: CreateMemoryRequest): Memory {
    const memoryId = this.generateMemoryId();
    
    const memoryData: Omit<MemoryData, 'created_at'> = {
      id: memoryId,
      repository_path: request.repositoryPath,
      agent_name: request.agentName,
      memory_type: request.memoryType,
      title: request.title,
      content: request.content,
      metadata: request.metadata || {},
      tags: request.tags || []
    };

    return this.memoryRepo.create(memoryData);
  }

  getMemory(memoryId: string): Memory | null {
    return this.memoryRepo.findById(memoryId);
  }

  updateMemory(memoryId: string, update: UpdateMemoryRequest): void {
    const memory = this.memoryRepo.findById(memoryId);
    if (!memory) {
      throw new Error(`Memory ${memoryId} not found`);
    }

    if (update.title !== undefined || update.content !== undefined) {
      const title = update.title !== undefined ? update.title : memory.title;
      const content = update.content !== undefined ? update.content : memory.content;
      this.memoryRepo.updateContent(memoryId, title, content);
    }

    if (update.metadata) {
      this.memoryRepo.updateMetadata(memoryId, update.metadata);
    }

    if (update.tags) {
      this.memoryRepo.updateTags(memoryId, update.tags);
    }
  }

  deleteMemory(memoryId: string): void {
    const memory = this.memoryRepo.findById(memoryId);
    if (!memory) {
      throw new Error(`Memory ${memoryId} not found`);
    }

    this.memoryRepo.delete(memoryId);
  }

  // Search and retrieval
  searchMemories(query: string, options: SearchOptions = {}): Memory[] {
    const {
      repositoryPath,
      memoryType,
      limit = 50
    } = options;

    return this.memoryRepo.searchContent(query, repositoryPath, memoryType)
      .slice(0, limit);
  }

  findMemoriesByAgent(agentName: string, repositoryPath?: string, limit = 100): Memory[] {
    return this.memoryRepo.findByAgent(agentName, repositoryPath)
      .slice(0, limit);
  }

  findMemoriesByType(memoryType: MemoryType, repositoryPath?: string, limit = 100): Memory[] {
    return this.memoryRepo.findByType(memoryType, repositoryPath)
      .slice(0, limit);
  }

  findMemoriesByTags(tags: string[], repositoryPath?: string, limit = 100): Memory[] {
    return this.memoryRepo.findByTags(tags, repositoryPath)
      .slice(0, limit);
  }

  // Specialized memory types
  storeInsight(
    repositoryPath: string,
    agentName: string,
    title: string,
    content: string,
    tags: string[] = [],
    metadata: Record<string, any> = {}
  ): Memory {
    return this.createMemory({
      repositoryPath,
      agentName,
      memoryType: MemoryType.INSIGHT,
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

  storeError(
    repositoryPath: string,
    agentName: string,
    error: string,
    context: Record<string, any> = {},
    tags: string[] = []
  ): Memory {
    return this.createMemory({
      repositoryPath,
      agentName,
      memoryType: MemoryType.ERROR_LOG,
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

  storeDecision(
    repositoryPath: string,
    agentName: string,
    decision: string,
    reasoning: string,
    context: Record<string, any> = {},
    tags: string[] = []
  ): Memory {
    return this.createMemory({
      repositoryPath,
      agentName,
      memoryType: MemoryType.DECISION,
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

  storeProgress(
    repositoryPath: string,
    agentName: string,
    milestone: string,
    details: string,
    metrics: Record<string, any> = {},
    tags: string[] = []
  ): Memory {
    return this.createMemory({
      repositoryPath,
      agentName,
      memoryType: MemoryType.PROGRESS,
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
  getRelevantMemories(
    query: string,
    repositoryPath: string,
    agentName?: string,
    limit = 10
  ): MemoryInsight[] {
    const searchResults = this.searchMemories(query, {
      repositoryPath,
      agentName,
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
        agentName: memory.agent_name,
        createdAt: memory.created_at
      };
    });

    // Sort by relevance score and return top results
    return insights
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }

  // Knowledge sharing between agents
  shareMemoryWithAgent(
    memoryId: string,
    targetAgentName: string,
    note?: string
  ): Memory {
    const originalMemory = this.memoryRepo.findById(memoryId);
    if (!originalMemory) {
      throw new Error(`Memory ${memoryId} not found`);
    }

    // Create a shared copy with reference to original
    const sharedTitle = `Shared: ${originalMemory.title}`;
    const sharedContent = note 
      ? `${note}\n\n--- Original Memory ---\n${originalMemory.content}`
      : originalMemory.content;

    return this.createMemory({
      repositoryPath: originalMemory.repository_path,
      agentName: targetAgentName,
      memoryType: MemoryType.SHARED,
      title: sharedTitle,
      content: sharedContent,
      tags: [...(originalMemory.tags || []), 'shared'],
      metadata: {
        originalMemoryId: memoryId,
        originalAgent: originalMemory.agent_name,
        sharedAt: new Date().toISOString(),
        sharedBy: originalMemory.agent_name
      }
    });
  }

  // Memory analytics
  getMemoryStats(repositoryPath?: string): {
    total: number;
    byType: Record<string, number>;
    byAgent: Record<string, number>;
    recentCount: number;
    topTags: Array<{ tag: string; count: number }>;
  } {
    const stats = this.memoryRepo.getStats(repositoryPath);
    const allTags = this.memoryRepo.getUniqueTags(repositoryPath);
    
    // Count tag usage
    const tagCounts: Record<string, number> = {};
    const memories = this.memoryRepo.findByRepositoryPath(repositoryPath || '');
    
    for (const memory of memories) {
      for (const tag of memory.tags || []) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
    
    const topTags = Object.entries(tagCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      ...stats,
      topTags
    };
  }

  // Memory maintenance
  addTag(memoryId: string, tag: string): void {
    this.memoryRepo.addTag(memoryId, tag);
  }

  removeTag(memoryId: string, tag: string): void {
    this.memoryRepo.removeTag(memoryId, tag);
  }

  getUniqueTags(repositoryPath?: string): string[] {
    return this.memoryRepo.getUniqueTags(repositoryPath);
  }

  cleanupOldMemories(repositoryPath: string, olderThanDays = 30): number {
    return this.memoryRepo.deleteOld(repositoryPath, olderThanDays);
  }

  deleteAgentMemories(agentName: string, repositoryPath?: string): number {
    return this.memoryRepo.deleteByAgent(agentName, repositoryPath);
  }

  // Batch operations
  createMemoryBatch(requests: CreateMemoryRequest[]): Memory[] {
    const results: Memory[] = [];
    
    this.db.transaction(() => {
      for (const request of requests) {
        try {
          const memory = this.createMemory(request);
          results.push(memory);
        } catch (error) {
          console.error(`Failed to create memory for ${request.agentName}:`, error);
        }
      }
    });

    return results;
  }

  // Export/Import for knowledge transfer
  exportMemories(repositoryPath: string, options: {
    agentName?: string;
    memoryType?: MemoryType;
    tags?: string[];
    sinceDate?: Date;
  } = {}): Array<{
    id: string;
    title: string;
    content: string;
    agentName: string;
    memoryType: MemoryType;
    tags: string[];
    metadata: Record<string, any>;
    createdAt: string;
  }> {
    let memories = this.memoryRepo.findByRepositoryPath(repositoryPath);
    
    // Apply filters
    if (options.agentName) {
      memories = memories.filter(m => m.agent_name === options.agentName);
    }
    
    if (options.memoryType) {
      memories = memories.filter(m => m.memory_type === options.memoryType);
    }
    
    if (options.tags && options.tags.length > 0) {
      memories = memories.filter(m => 
        options.tags!.some(tag => (m.tags || []).includes(tag))
      );
    }
    
    if (options.sinceDate) {
      memories = memories.filter(m => m.created_at >= options.sinceDate!);
    }

    return memories.map(memory => ({
      id: memory.id,
      title: memory.title,
      content: memory.content,
      agentName: memory.agent_name,
      memoryType: memory.memory_type,
      tags: memory.tags || [],
      metadata: memory.metadata || {},
      createdAt: memory.created_at.toISOString()
    }));
  }

  // Convenience method for quick memory storage  
  storeMemory(
    repositoryPath: string,
    agentName: string,
    memoryType: string,
    title: string,
    content: string,
    tags: string[] = []
  ): Memory {
    // Convert string memoryType to enum
    let type: MemoryType;
    switch (memoryType.toLowerCase()) {
      case 'insight':
        type = MemoryType.INSIGHT;
        break;
      case 'error_log':
      case 'error':
        type = MemoryType.ERROR_LOG;
        break;
      case 'decision':
        type = MemoryType.DECISION;
        break;
      case 'progress':
        type = MemoryType.PROGRESS;
        break;
      case 'shared':
      default:
        type = MemoryType.SHARED;
        break;
    }

    return this.createMemory({
      repositoryPath,
      agentName,
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