import { eq, and, or, like, gte, lte, desc, asc, sql, inArray } from 'drizzle-orm';
import { BaseRepository, createRepositoryConfig, RepositoryError } from './index.js';
import { DatabaseManager } from '../database/index.js';
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
  updateKnowledgeInsightSchema,
  type KnowledgeEntity,
  type NewKnowledgeEntity,
  type KnowledgeEntityUpdate,
  type KnowledgeRelationship,
  type NewKnowledgeRelationship,
  type KnowledgeRelationshipUpdate,
  type KnowledgeInsight,
  type NewKnowledgeInsight,
  type KnowledgeInsightUpdate,
  type EntityType,
  type RelationshipType,
  type EntityFilter,
  type RelationshipFilter,
  type KnowledgeSearch,
} from '../schemas/knowledge-graph.js';

/**
 * Repository for managing knowledge graph entities
 */
export class KnowledgeEntityRepository extends BaseRepository<
  typeof knowledgeEntities,
  KnowledgeEntity,
  NewKnowledgeEntity,
  KnowledgeEntityUpdate
> {
  constructor(drizzleManager: DatabaseManager) {
    super(drizzleManager, createRepositoryConfig(
      knowledgeEntities,
      knowledgeEntities.id,
      insertKnowledgeEntitySchema,
      selectKnowledgeEntitySchema,
      updateKnowledgeEntitySchema,
      'knowledge-entity-repository'
    ));
  }

  /**
   * Find entities by repository path
   */
  async findByRepositoryPath(repositoryPath: string, entityType?: EntityType): Promise<KnowledgeEntity[]> {
    const conditions = [eq(knowledgeEntities.repositoryPath, repositoryPath)];
    
    if (entityType) {
      conditions.push(eq(knowledgeEntities.entityType, entityType));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    return this.query()
      .where(whereClause)
      .orderBy(knowledgeEntities.importanceScore, 'desc')
      .execute();
  }

  /**
   * Find entities by type
   */
  async findByType(entityType: EntityType, repositoryPath?: string): Promise<KnowledgeEntity[]> {
    const conditions = [eq(knowledgeEntities.entityType, entityType)];
    
    if (repositoryPath) {
      conditions.push(eq(knowledgeEntities.repositoryPath, repositoryPath));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    return this.query()
      .where(whereClause)
      .orderBy(knowledgeEntities.importanceScore, 'desc')
      .execute();
  }

  /**
   * Find entities by discoverer
   */
  async findByDiscoverer(discoveredBy: string, repositoryPath?: string): Promise<KnowledgeEntity[]> {
    const conditions = [eq(knowledgeEntities.discoveredBy, discoveredBy)];
    
    if (repositoryPath) {
      conditions.push(eq(knowledgeEntities.repositoryPath, repositoryPath));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    return this.query()
      .where(whereClause)
      .orderBy(knowledgeEntities.createdAt, 'desc')
      .execute();
  }

  /**
   * Find high-importance entities
   */
  async findHighImportance(
    repositoryPath: string,
    minImportance: number = 0.7,
    limit: number = 20
  ): Promise<KnowledgeEntity[]> {
    return this.query()
      .where(and(
        eq(knowledgeEntities.repositoryPath, repositoryPath),
        gte(knowledgeEntities.importanceScore, minImportance)
      ))
      .orderBy(knowledgeEntities.importanceScore, 'desc')
      .limit(limit)
      .execute();
  }

  /**
   * Find recently accessed entities
   */
  async findRecentlyAccessed(
    repositoryPath: string,
    limit: number = 20
  ): Promise<KnowledgeEntity[]> {
    return this.query()
      .where(and(
        eq(knowledgeEntities.repositoryPath, repositoryPath),
        sql`${knowledgeEntities.lastAccessed} IS NOT NULL`
      ))
      .orderBy(knowledgeEntities.lastAccessed, 'desc')
      .limit(limit)
      .execute();
  }

  /**
   * Search entities by name or description
   */
  async searchByText(
    repositoryPath: string,
    searchTerm: string,
    entityType?: EntityType
  ): Promise<KnowledgeEntity[]> {
    const conditions = [
      eq(knowledgeEntities.repositoryPath, repositoryPath),
      or(
        like(knowledgeEntities.name, `%${searchTerm}%`),
        like(knowledgeEntities.description, `%${searchTerm}%`)
      )
    ];

    if (entityType) {
      conditions.push(eq(knowledgeEntities.entityType, entityType));
    }

    const whereClause = and(...conditions);
    return this.query()
      .where(whereClause)
      .orderBy(knowledgeEntities.relevanceScore, 'desc')
      .execute();
  }

  /**
   * Update entity access tracking
   */
  async updateAccess(entityId: string): Promise<KnowledgeEntity | null> {
    try {
      const entity = await this.findById(entityId);
      if (!entity) {
        return null;
      }

      return await this.update(entityId, {
        accessCount: entity.accessCount + 1,
        lastAccessed: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error('Failed to update entity access', { entityId, error });
      throw error;
    }
  }

  /**
   * Get entity statistics
   */
  async getEntityStats(repositoryPath: string): Promise<{
    totalEntities: number;
    byType: Record<EntityType, number>;
    highImportance: number;
    validated: number;
    recentlyCreated: number;
    averageImportance: number;
    averageConfidence: number;
  }> {
    const entities = await this.findByRepositoryPath(repositoryPath);
    
    const stats = {
      totalEntities: entities.length,
      byType: {} as Record<EntityType, number>,
      highImportance: entities.filter(e => e.importanceScore >= 0.7).length,
      validated: entities.filter(e => e.validated).length,
      recentlyCreated: entities.filter(e => {
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        return new Date(e.createdAt) > dayAgo;
      }).length,
      averageImportance: entities.reduce((sum, e) => sum + e.importanceScore, 0) / entities.length || 0,
      averageConfidence: entities.reduce((sum, e) => sum + e.confidenceScore, 0) / entities.length || 0,
    };

    // Count by type
    entities.forEach(entity => {
      stats.byType[entity.entityType] = (stats.byType[entity.entityType] || 0) + 1;
    });

    return stats;
  }

  /**
   * Advanced entity filtering
   */
  async findFiltered(filter: EntityFilter): Promise<{
    entities: KnowledgeEntity[];
    total: number;
    hasMore: boolean;
  }> {
    const conditions = [];

    if (filter.repositoryPath) {
      conditions.push(eq(knowledgeEntities.repositoryPath, filter.repositoryPath));
    }

    if (filter.entityType) {
      conditions.push(eq(knowledgeEntities.entityType, filter.entityType));
    }

    if (filter.discoveredBy) {
      conditions.push(eq(knowledgeEntities.discoveredBy, filter.discoveredBy));
    }

    if (filter.discoveredDuring) {
      conditions.push(eq(knowledgeEntities.discoveredDuring, filter.discoveredDuring));
    }

    if (filter.validated !== undefined) {
      conditions.push(eq(knowledgeEntities.validated, filter.validated));
    }

    if (filter.minImportance !== undefined) {
      conditions.push(gte(knowledgeEntities.importanceScore, filter.minImportance));
    }

    if (filter.minConfidence !== undefined) {
      conditions.push(gte(knowledgeEntities.confidenceScore, filter.minConfidence));
    }

    if (filter.createdAfter) {
      conditions.push(gte(knowledgeEntities.createdAt, filter.createdAfter));
    }

    if (filter.createdBefore) {
      conditions.push(lte(knowledgeEntities.createdAt, filter.createdBefore));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions.length === 1 ? conditions[0] : undefined;

    const result = await this.list({
      where: whereClause,
      orderBy: knowledgeEntities.importanceScore,
      limit: filter.limit,
      offset: filter.offset,
    });

    return {
      entities: result.data,
      total: result.total,
      hasMore: result.hasMore,
    };
  }
}

/**
 * Repository for managing knowledge graph relationships
 */
export class KnowledgeRelationshipRepository extends BaseRepository<
  typeof knowledgeRelationships,
  KnowledgeRelationship,
  NewKnowledgeRelationship,
  KnowledgeRelationshipUpdate
> {
  constructor(drizzleManager: DatabaseManager) {
    super(drizzleManager, createRepositoryConfig(
      knowledgeRelationships,
      knowledgeRelationships.id,
      insertKnowledgeRelationshipSchema,
      selectKnowledgeRelationshipSchema,
      updateKnowledgeRelationshipSchema,
      'knowledge-relationship-repository'
    ));
  }

  /**
   * Find relationships by entity
   */
  async findByEntity(entityId: string, relationshipType?: RelationshipType): Promise<KnowledgeRelationship[]> {
    const conditions = [
      or(
        eq(knowledgeRelationships.fromEntityId, entityId),
        eq(knowledgeRelationships.toEntityId, entityId)
      )
    ];

    if (relationshipType) {
      conditions.push(eq(knowledgeRelationships.relationshipType, relationshipType));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    return this.query()
      .where(whereClause)
      .orderBy(knowledgeRelationships.strength, 'desc')
      .execute();
  }

  /**
   * Find outgoing relationships
   */
  async findOutgoing(fromEntityId: string, relationshipType?: RelationshipType): Promise<KnowledgeRelationship[]> {
    const conditions = [eq(knowledgeRelationships.fromEntityId, fromEntityId)];

    if (relationshipType) {
      conditions.push(eq(knowledgeRelationships.relationshipType, relationshipType));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    return this.query()
      .where(whereClause)
      .orderBy(knowledgeRelationships.strength, 'desc')
      .execute();
  }

  /**
   * Find incoming relationships
   */
  async findIncoming(toEntityId: string, relationshipType?: RelationshipType): Promise<KnowledgeRelationship[]> {
    const conditions = [eq(knowledgeRelationships.toEntityId, toEntityId)];

    if (relationshipType) {
      conditions.push(eq(knowledgeRelationships.relationshipType, relationshipType));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    return this.query()
      .where(whereClause)
      .orderBy(knowledgeRelationships.strength, 'desc')
      .execute();
  }

  /**
   * Find relationships by type
   */
  async findByType(relationshipType: RelationshipType, repositoryPath?: string): Promise<KnowledgeRelationship[]> {
    const conditions = [eq(knowledgeRelationships.relationshipType, relationshipType)];

    if (repositoryPath) {
      conditions.push(eq(knowledgeRelationships.repositoryPath, repositoryPath));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    return this.query()
      .where(whereClause)
      .orderBy(knowledgeRelationships.strength, 'desc')
      .execute();
  }

  /**
   * Find strong relationships
   */
  async findStrong(
    repositoryPath: string,
    minStrength: number = 0.7,
    limit: number = 20
  ): Promise<KnowledgeRelationship[]> {
    return this.query()
      .where(and(
        eq(knowledgeRelationships.repositoryPath, repositoryPath),
        gte(knowledgeRelationships.strength, minStrength)
      ))
      .orderBy(knowledgeRelationships.strength, 'desc')
      .limit(limit)
      .execute();
  }

  /**
   * Find relationships between specific entities
   */
  async findBetween(
    fromEntityId: string,
    toEntityId: string,
    relationshipType?: RelationshipType
  ): Promise<KnowledgeRelationship[]> {
    const conditions = [
      or(
        and(
          eq(knowledgeRelationships.fromEntityId, fromEntityId),
          eq(knowledgeRelationships.toEntityId, toEntityId)
        ),
        and(
          eq(knowledgeRelationships.fromEntityId, toEntityId),
          eq(knowledgeRelationships.toEntityId, fromEntityId)
        )
      )
    ];

    if (relationshipType) {
      conditions.push(eq(knowledgeRelationships.relationshipType, relationshipType));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    return this.query()
      .where(whereClause)
      .orderBy(knowledgeRelationships.strength, 'desc')
      .execute();
  }

  /**
   * Strengthen relationship based on evidence
   */
  async strengthenRelationship(
    relationshipId: string,
    evidenceIncrease: number = 1
  ): Promise<KnowledgeRelationship | null> {
    try {
      const relationship = await this.findById(relationshipId);
      if (!relationship) {
        return null;
      }

      const newEvidenceCount = relationship.evidenceCount + evidenceIncrease;
      const newStrength = Math.min(1.0, relationship.strength + (evidenceIncrease * 0.1));

      return await this.update(relationshipId, {
        evidenceCount: newEvidenceCount,
        strength: newStrength,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error('Failed to strengthen relationship', { relationshipId, error });
      throw error;
    }
  }

  /**
   * Get relationship statistics
   */
  async getRelationshipStats(repositoryPath: string): Promise<{
    totalRelationships: number;
    byType: Record<RelationshipType, number>;
    strongRelationships: number;
    validated: number;
    averageStrength: number;
    averageConfidence: number;
  }> {
    const relationships = await this.query()
      .where(eq(knowledgeRelationships.repositoryPath, repositoryPath))
      .execute();

    const stats = {
      totalRelationships: relationships.length,
      byType: {} as Record<RelationshipType, number>,
      strongRelationships: relationships.filter(r => r.strength >= 0.7).length,
      validated: relationships.filter(r => r.validated).length,
      averageStrength: relationships.reduce((sum, r) => sum + r.strength, 0) / relationships.length || 0,
      averageConfidence: relationships.reduce((sum, r) => sum + r.confidence, 0) / relationships.length || 0,
    };

    // Count by type
    relationships.forEach(relationship => {
      stats.byType[relationship.relationshipType] = (stats.byType[relationship.relationshipType] || 0) + 1;
    });

    return stats;
  }

  /**
   * Advanced relationship filtering
   */
  async findFiltered(filter: RelationshipFilter): Promise<{
    relationships: KnowledgeRelationship[];
    total: number;
    hasMore: boolean;
  }> {
    const conditions = [];

    if (filter.repositoryPath) {
      conditions.push(eq(knowledgeRelationships.repositoryPath, filter.repositoryPath));
    }

    if (filter.fromEntityId) {
      conditions.push(eq(knowledgeRelationships.fromEntityId, filter.fromEntityId));
    }

    if (filter.toEntityId) {
      conditions.push(eq(knowledgeRelationships.toEntityId, filter.toEntityId));
    }

    if (filter.relationshipType) {
      conditions.push(eq(knowledgeRelationships.relationshipType, filter.relationshipType));
    }

    if (filter.minStrength !== undefined) {
      conditions.push(gte(knowledgeRelationships.strength, filter.minStrength));
    }

    if (filter.minConfidence !== undefined) {
      conditions.push(gte(knowledgeRelationships.confidence, filter.minConfidence));
    }

    if (filter.validated !== undefined) {
      conditions.push(eq(knowledgeRelationships.validated, filter.validated));
    }

    if (filter.discoveredBy) {
      conditions.push(eq(knowledgeRelationships.discoveredBy, filter.discoveredBy));
    }

    if (filter.createdAfter) {
      conditions.push(gte(knowledgeRelationships.createdAt, filter.createdAfter));
    }

    if (filter.createdBefore) {
      conditions.push(lte(knowledgeRelationships.createdAt, filter.createdBefore));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions.length === 1 ? conditions[0] : undefined;

    const result = await this.list({
      where: whereClause,
      orderBy: knowledgeRelationships.strength,
      limit: filter.limit,
      offset: filter.offset,
    });

    return {
      relationships: result.data,
      total: result.total,
      hasMore: result.hasMore,
    };
  }
}

/**
 * Repository for managing knowledge insights
 */
export class KnowledgeInsightRepository extends BaseRepository<
  typeof knowledgeInsights,
  KnowledgeInsight,
  NewKnowledgeInsight,
  KnowledgeInsightUpdate
> {
  constructor(drizzleManager: DatabaseManager) {
    super(drizzleManager, createRepositoryConfig(
      knowledgeInsights,
      knowledgeInsights.id,
      insertKnowledgeInsightSchema,
      selectKnowledgeInsightSchema,
      updateKnowledgeInsightSchema,
      'knowledge-insight-repository'
    ));
  }

  /**
   * Find insights by repository path
   */
  async findByRepositoryPath(repositoryPath: string): Promise<KnowledgeInsight[]> {
    return this.query()
      .where(eq(knowledgeInsights.repositoryPath, repositoryPath))
      .orderBy(knowledgeInsights.confidence, 'desc')
      .execute();
  }

  /**
   * Find insights by type
   */
  async findByType(insightType: 'pattern' | 'correlation' | 'anomaly' | 'trend' | 'optimization' | 'risk' | 'opportunity', repositoryPath?: string): Promise<KnowledgeInsight[]> {
    const conditions = [eq(knowledgeInsights.insightType, insightType)];

    if (repositoryPath) {
      conditions.push(eq(knowledgeInsights.repositoryPath, repositoryPath));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    return this.query()
      .where(whereClause)
      .orderBy(knowledgeInsights.confidence, 'desc')
      .execute();
  }

  /**
   * Find high-impact insights
   */
  async findHighImpact(
    repositoryPath: string,
    minImpact: number = 0.7,
    limit: number = 20
  ): Promise<KnowledgeInsight[]> {
    return this.query()
      .where(and(
        eq(knowledgeInsights.repositoryPath, repositoryPath),
        gte(knowledgeInsights.impact, minImpact)
      ))
      .orderBy(knowledgeInsights.impact, 'desc')
      .limit(limit)
      .execute();
  }

  /**
   * Find actionable insights
   */
  async findActionable(
    repositoryPath: string,
    minActionability: number = 0.7,
    limit: number = 20
  ): Promise<KnowledgeInsight[]> {
    return this.query()
      .where(and(
        eq(knowledgeInsights.repositoryPath, repositoryPath),
        gte(knowledgeInsights.actionability, minActionability)
      ))
      .orderBy(knowledgeInsights.actionability, 'desc')
      .limit(limit)
      .execute();
  }

  /**
   * Find recent insights
   */
  async findRecent(
    repositoryPath: string,
    hours: number = 24,
    limit: number = 20
  ): Promise<KnowledgeInsight[]> {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    
    return this.query()
      .where(and(
        eq(knowledgeInsights.repositoryPath, repositoryPath),
        gte(knowledgeInsights.createdAt, cutoffTime)
      ))
      .orderBy(knowledgeInsights.createdAt, 'desc')
      .limit(limit)
      .execute();
  }

  /**
   * Find insights by discoverer
   */
  async findByDiscoverer(discoveredBy: string, repositoryPath?: string): Promise<KnowledgeInsight[]> {
    const conditions = [eq(knowledgeInsights.discoveredBy, discoveredBy)];

    if (repositoryPath) {
      conditions.push(eq(knowledgeInsights.repositoryPath, repositoryPath));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];
    return this.query()
      .where(whereClause)
      .orderBy(knowledgeInsights.createdAt, 'desc')
      .execute();
  }

  /**
   * Mark insight as applied
   */
  async markAsApplied(insightId: string, appliedBy: string): Promise<KnowledgeInsight | null> {
    try {
      return await this.update(insightId, {
        applied: true,
        appliedBy,
        appliedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error('Failed to mark insight as applied', { insightId, error });
      throw error;
    }
  }

  /**
   * Validate insight
   */
  async validateInsight(insightId: string, validatedBy: string): Promise<KnowledgeInsight | null> {
    try {
      return await this.update(insightId, {
        validated: true,
        validatedBy,
        validatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error('Failed to validate insight', { insightId, error });
      throw error;
    }
  }

  /**
   * Get insight statistics
   */
  async getInsightStats(repositoryPath: string): Promise<{
    totalInsights: number;
    byType: Record<string, number>;
    highImpact: number;
    actionable: number;
    validated: number;
    applied: number;
    recent: number;
    averageConfidence: number;
    averageImpact: number;
    averageActionability: number;
  }> {
    const insights = await this.findByRepositoryPath(repositoryPath);
    
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const stats = {
      totalInsights: insights.length,
      byType: {} as Record<string, number>,
      highImpact: insights.filter(i => i.impact >= 0.7).length,
      actionable: insights.filter(i => i.actionability >= 0.7).length,
      validated: insights.filter(i => i.validated).length,
      applied: insights.filter(i => i.applied).length,
      recent: insights.filter(i => new Date(i.createdAt) > dayAgo).length,
      averageConfidence: insights.reduce((sum, i) => sum + i.confidence, 0) / insights.length || 0,
      averageImpact: insights.reduce((sum, i) => sum + i.impact, 0) / insights.length || 0,
      averageActionability: insights.reduce((sum, i) => sum + i.actionability, 0) / insights.length || 0,
    };

    // Count by type
    insights.forEach(insight => {
      stats.byType[insight.insightType] = (stats.byType[insight.insightType] || 0) + 1;
    });

    return stats;
  }
}