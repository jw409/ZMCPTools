import { eq, and, lt, or, sql, desc } from 'drizzle-orm';
import { BaseRepository, createRepositoryConfig } from './index.js';
import { DatabaseManager } from '../database/index.js';
import {
  agentSessions,
  insertAgentSessionSchema,
  selectAgentSessionSchema,
  updateAgentSessionSchema,
  type AgentSession,
  type NewAgentSession,
  type AgentSessionUpdate,
  type AgentStatus,
  type AgentFilter,
} from '../schemas/index.js';

/**
 * Repository for managing agent sessions using the new Drizzle ORM pattern
 * 
 * Provides type-safe CRUD operations and agent-specific query methods
 */
export class AgentRepository extends BaseRepository<
  typeof agentSessions,
  AgentSession,
  NewAgentSession,
  AgentSessionUpdate
> {
  constructor(drizzleManager: DatabaseManager) {
    super(drizzleManager, createRepositoryConfig(
      agentSessions,
      agentSessions.id,
      insertAgentSessionSchema,
      selectAgentSessionSchema,
      updateAgentSessionSchema,
      'agent-repository'
    ));
  }

  /**
   * Find agents by repository path with optional status filter
   */
  async findByRepositoryPath(repositoryPath: string, status?: AgentStatus, limit: number = 5, offset: number = 0): Promise<AgentSession[]> {
    const conditions = [eq(agentSessions.repositoryPath, repositoryPath)];
    
    if (status) {
      conditions.push(eq(agentSessions.status, status));
    }

    let queryBuilder = this.query();
    if (conditions.length > 0) {
      const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
      queryBuilder = queryBuilder.where(whereClause);
    }
    return queryBuilder
      .orderBy(agentSessions.lastHeartbeat, 'desc')
      .limit(limit)
      .offset(offset)
      .execute();
  }

  /**
   * Find active agents across all repositories
   */
  async findActiveAgents(repositoryPath?: string): Promise<AgentSession[]> {
    const conditions = [eq(agentSessions.status, 'active')];
    
    if (repositoryPath) {
      conditions.push(eq(agentSessions.repositoryPath, repositoryPath));
    }

    let queryBuilder = this.query();
    if (conditions.length > 0) {
      const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
      queryBuilder = queryBuilder.where(whereClause);
    }
    return queryBuilder
      .orderBy(agentSessions.lastHeartbeat, 'desc')
      .execute();
  }

  /**
   * Find agent by Claude process ID
   */
  async findByPid(claudePid: number): Promise<AgentSession | null> {
    return this.query()
      .where(eq(agentSessions.claudePid, claudePid))
      .first();
  }

  /**
   * Find stale agents that haven't sent heartbeats recently
   */
  async findStaleAgents(staleMinutes = 30): Promise<AgentSession[]> {
    const staleThreshold = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();
    
    return this.query()
      .where(and(
        or(
          eq(agentSessions.status, 'active'),
          eq(agentSessions.status, 'idle')
        ),
        lt(agentSessions.lastHeartbeat, staleThreshold)
      ))
      .orderBy(agentSessions.lastHeartbeat)
      .execute();
  }

  /**
   * Update agent heartbeat timestamp
   */
  async updateHeartbeat(id: string, status?: AgentStatus): Promise<AgentSession | null> {
    const updateData: Partial<AgentSessionUpdate> = {
      lastHeartbeat: new Date().toISOString(),
    };

    if (status) {
      updateData.status = status;
    }

    return this.update(id, updateData as AgentSessionUpdate);
  }

  /**
   * Update agent metadata
   */
  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<AgentSession | null> {
    return this.update(id, {
      agentMetadata: metadata,
      lastHeartbeat: new Date().toISOString(),
    } as AgentSessionUpdate);
  }

  /**
   * Update agent status
   */
  async updateStatus(id: string, status: AgentStatus): Promise<AgentSession | null> {
    return this.update(id, {
      status,
      lastHeartbeat: new Date().toISOString(),
    } as AgentSessionUpdate);
  }

  /**
   * Find agents with specific capability
   */
  async findByCapability(capability: string, repositoryPath?: string): Promise<AgentSession[]> {
    // Note: This is a simplified search. For production, you might want to use
    // a more sophisticated JSON search or full-text search
    const conditions = [];
    
    if (repositoryPath) {
      conditions.push(eq(agentSessions.repositoryPath, repositoryPath));
    }

    let queryBuilder = this.query();
    if (conditions.length > 0) {
      const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
      queryBuilder = queryBuilder.where(whereClause);
    }
    const agents = await queryBuilder.execute();

    // Filter by capability in application code since SQLite JSON operations can be complex
    return agents.filter(agent => 
      agent.capabilities && agent.capabilities.includes(capability)
    );
  }

  /**
   * Get agent count by status for a repository
   */
  async getCountByStatus(repositoryPath: string): Promise<Record<AgentStatus, number>> {
    const agents = await this.findByRepositoryPath(repositoryPath);
    
    const counts: Record<string, number> = {};
    const statusValues: AgentStatus[] = ['active', 'idle', 'completed', 'terminated', 'failed', 'initializing'];
    
    // Initialize all statuses with 0
    statusValues.forEach(status => {
      counts[status] = 0;
    });
    
    // Count actual statuses
    agents.forEach(agent => {
      counts[agent.status] = (counts[agent.status] || 0) + 1;
    });
    
    return counts as Record<AgentStatus, number>;
  }

  /**
   * Cleanup terminated and failed agents older than specified days
   */
  async cleanupOldAgents(days = 7): Promise<number> {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    
    const oldAgents = await this.query()
      .where(and(
        or(
          eq(agentSessions.status, 'terminated'),
          eq(agentSessions.status, 'failed'),
          eq(agentSessions.status, 'completed')
        ),
        lt(agentSessions.lastHeartbeat, cutoffDate)
      ))
      .execute();

    let deletedCount = 0;
    
    // Delete each agent individually to ensure proper logging
    for (const agent of oldAgents) {
      const deleted = await this.delete(agent.id);
      if (deleted) {
        deletedCount++;
      }
    }

    this.logger.info('Cleaned up old agents', { 
      deletedCount, 
      cutoffDate,
      daysOld: days 
    });
    
    return deletedCount;
  }

  /**
   * Advanced filtering with pagination
   */
  async findFiltered(filter: AgentFilter): Promise<{
    agents: AgentSession[];
    total: number;
    hasMore: boolean;
  }> {
    const conditions = [];

    if (filter.repositoryPath) {
      conditions.push(eq(agentSessions.repositoryPath, filter.repositoryPath));
    }

    if (filter.status) {
      conditions.push(eq(agentSessions.status, filter.status));
    }

    if (filter.agentId) {
      // Simple name matching - in production you might want fuzzy matching
      conditions.push(eq(agentSessions.agentName, filter.agentId));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions.length === 1 ? conditions[0] : undefined;

    const result = await this.list({
      where: whereClause,
      orderBy: agentSessions.lastHeartbeat,
      limit: filter.limit,
      offset: filter.offset,
    });

    // Additional filtering for capabilities (done in application code)
    let filteredAgents = result.data;
    if (filter.capability) {
      filteredAgents = filteredAgents.filter(agent =>
        agent.capabilities && agent.capabilities.includes(filter.capability!)
      );
    }

    return {
      agents: filteredAgents,
      total: result.total,
      hasMore: result.hasMore,
    };
  }

  /**
   * Update agent with result data
   */
  async updateWithResults(
    id: string,
    results: {
      results?: Record<string, any>;
      artifacts?: { created: string[]; modified: string[] };
      completionMessage?: string;
      errorDetails?: Record<string, any>;
      resultPath?: string;
    }
  ): Promise<AgentSession | null> {
    const updateData: any = {
      lastHeartbeat: new Date().toISOString(),
    };

    // Only update fields that are provided
    if (results.results !== undefined) {
      updateData.results = results.results;
    }
    if (results.artifacts !== undefined) {
      updateData.artifacts = results.artifacts;
    }
    if (results.completionMessage !== undefined) {
      updateData.completionMessage = results.completionMessage;
    }
    if (results.errorDetails !== undefined) {
      updateData.errorDetails = results.errorDetails;
    }
    if (results.resultPath !== undefined) {
      updateData.resultPath = results.resultPath;
    }

    // Set status based on error presence
    if (results.errorDetails) {
      updateData.status = 'failed';
    } else if (results.results || results.completionMessage) {
      updateData.status = 'completed';
    }

    return this.update(id, updateData);
  }

  /**
   * Get agents with results
   */
  async findWithResults(repositoryPath?: string, limit: number = 10, offset: number = 0): Promise<AgentSession[]> {
    const conditions = [];

    if (repositoryPath) {
      conditions.push(eq(agentSessions.repositoryPath, repositoryPath));
    }

    // Find agents that have result data
    conditions.push(
      or(
        sql`${agentSessions.results} IS NOT NULL`,
        sql`${agentSessions.completionMessage} IS NOT NULL`,
        sql`${agentSessions.resultPath} IS NOT NULL`
      )
    );

    // Use direct Drizzle query to avoid orderBy issues with QueryBuilder
    let query = this.drizzle.select().from(agentSessions);

    if (conditions.length > 0) {
      const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
      query = query.where(whereClause);
    }

    return query
      .orderBy(desc(agentSessions.lastHeartbeat))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Get agent results summary
   */
  async getResultsSummary(repositoryPath?: string): Promise<{
    totalAgents: number;
    withResults: number;
    completed: number;
    failed: number;
    withArtifacts: number;
  }> {
    const conditions = [];
    if (repositoryPath) {
      conditions.push(eq(agentSessions.repositoryPath, repositoryPath));
    }

    let queryBuilder = this.query();
    if (conditions.length > 0) {
      const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
      queryBuilder = queryBuilder.where(whereClause);
    }

    const agents = await queryBuilder.execute();

    return {
      totalAgents: agents.length,
      withResults: agents.filter(a => a.results || a.completionMessage || a.resultPath).length,
      completed: agents.filter(a => a.status === 'completed').length,
      failed: agents.filter(a => a.status === 'failed').length,
      withArtifacts: agents.filter(a => a.artifacts && (a.artifacts.created.length > 0 || a.artifacts.modified.length > 0)).length,
    };
  }

  /**
   * Clean up agents with missing result files
   */
  async cleanupOrphanedResults(repositoryPath?: string): Promise<{
    agentsChecked: number;
    orphanedAgents: string[];
    cleanedUp: number;
  }> {
    const conditions = [
      sql`${agentSessions.resultPath} IS NOT NULL`
    ];

    if (repositoryPath) {
      conditions.push(eq(agentSessions.repositoryPath, repositoryPath));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    const agentsWithPaths = await this.query()
      .where(whereClause)
      .execute();

    const orphanedAgents: string[] = [];
    const { existsSync } = await import('fs');
    const { join } = await import('path');

    // Check if result paths exist
    for (const agent of agentsWithPaths) {
      if (agent.resultPath) {
        const fullPath = repositoryPath
          ? join(repositoryPath, agent.resultPath)
          : join(agent.repositoryPath, agent.resultPath);

        if (!existsSync(fullPath)) {
          orphanedAgents.push(agent.id);
        }
      }
    }

    // Clean up orphaned entries (clear result path)
    let cleanedUp = 0;
    for (const agentId of orphanedAgents) {
      const success = await this.update(agentId, {
        resultPath: null,
        lastHeartbeat: new Date().toISOString(),
      });
      if (success) {
        cleanedUp++;
      }
    }

    return {
      agentsChecked: agentsWithPaths.length,
      orphanedAgents,
      cleanedUp,
    };
  }
}