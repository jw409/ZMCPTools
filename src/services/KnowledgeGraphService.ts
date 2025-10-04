/**
 * Knowledge Graph Service
 * Combines SQLite for structured data and LanceDB for vector embeddings
 * Provides automatic insight detection and relationship tracking
 */

import { Logger } from '../utils/logger.js';
import { VectorSearchService } from './VectorSearchService.js';
import { DatabaseManager } from '../database/index.js';
import { randomUUID } from 'crypto';
import {
  type KnowledgeEntity,
  type NewKnowledgeEntity,
  type KnowledgeEntityUpdate,
  type KnowledgeRelationship,
  type NewKnowledgeRelationship,
  type KnowledgeRelationshipUpdate,
  type KnowledgeInsight,
  type NewKnowledgeInsight,
  type EntityType,
  type RelationshipType,
  type KnowledgeSearch,
  type EntityFilter,
  type RelationshipFilter,
  insightDetectionRules,
  type InsightDetectionRules,
} from '../schemas/knowledge-graph.js';
import { 
  knowledgeEntities, 
  knowledgeRelationships, 
  knowledgeInsights,
  insertKnowledgeEntitySchema,
  insertKnowledgeRelationshipSchema,
  insertKnowledgeInsightSchema
} from '../schemas/knowledge-graph.js';
import { eq, and, or, gte, lte, like, desc, asc, sql } from 'drizzle-orm';

export interface KnowledgeGraphConfig {
  embeddingModel?: string;
  semanticSearchThreshold?: number;
  insightDetectionInterval?: number;
  autoDetectInsights?: boolean;
  maxRelationshipDistance?: number;
}

export interface EntityWithRelationships extends KnowledgeEntity {
  relationships: KnowledgeRelationship[];
  relatedEntities: KnowledgeEntity[];
}

export interface InsightDetectionResult {
  insight: KnowledgeInsight;
  confidence: number;
  evidence: Record<string, unknown>;
  relatedEntities: KnowledgeEntity[];
  relatedRelationships: KnowledgeRelationship[];
}

export interface KnowledgeGraphStats {
  totalEntities: number;
  totalRelationships: number;
  totalInsights: number;
  entitiesByType: Record<EntityType, number>;
  relationshipsByType: Record<RelationshipType, number>;
  topEntitiesByImportance: KnowledgeEntity[];
  recentInsights: KnowledgeInsight[];
}

export class KnowledgeGraphService {
  private logger: Logger;
  private vectorService: VectorSearchService;
  private config: KnowledgeGraphConfig;
  private readonly KNOWLEDGE_GRAPH_COLLECTION = 'knowledge_graph';

  constructor(
    private db: DatabaseManager,
    vectorService: VectorSearchService,
    config: KnowledgeGraphConfig = {}
  ) {
    this.logger = new Logger('knowledge-graph-service');
    this.vectorService = vectorService;
    this.config = {
      embeddingModel: 'gemma_embed', // Use TalentOS GPU embedding service (768D)
      semanticSearchThreshold: 0.7,
      insightDetectionInterval: 300000, // 5 minutes
      autoDetectInsights: true,
      maxRelationshipDistance: 3,
      ...config
    };

    this.initializeService();
  }

  private async initializeService(): Promise<void> {
    try {
      // Add retry logic with exponential backoff
      await this.initializeVectorCollectionWithRetry();
      
      // Start automatic insight detection if enabled
      if (this.config.autoDetectInsights) {
        this.startInsightDetection();
      }

      this.logger.info('Knowledge Graph Service initialized', {
        collection: this.KNOWLEDGE_GRAPH_COLLECTION,
        autoDetectInsights: this.config.autoDetectInsights
      });
    } catch (error) {
      this.logger.error('Failed to initialize Knowledge Graph Service', error);
      // Don't rethrow - allow service to continue without knowledge graph
    }
  }

  private async initializeVectorCollectionWithRetry(maxRetries = 3): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.vectorService.getOrCreateCollection(this.KNOWLEDGE_GRAPH_COLLECTION, {
          type: 'knowledge_graph',
          embeddingModel: this.config.embeddingModel,
          createdAt: new Date().toISOString()
        });
        return; // Success
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        
        if (errorMsg.includes('entered unreachable code') && attempt < maxRetries) {
          this.logger.warn(`LanceDB unreachable code error, retrying (${attempt}/${maxRetries})`, { error: errorMsg });
          
          // Wait with exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
          
          continue;
        }
        
        throw error; // Re-throw on final attempt or other errors
      }
    }
  }

  /**
   * Create a new knowledge entity
   */
  async createEntity(data: NewKnowledgeEntity): Promise<KnowledgeEntity> {
    try {
      const validatedData = insertKnowledgeEntitySchema.parse({
        ...data,
        id: data.id || randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Insert into SQLite
      const result = await this.db.drizzle
        .insert(knowledgeEntities)
        .values(validatedData as any)
        .returning()
        .execute();

      const entity = result[0] as KnowledgeEntity;

      // Add to vector store for semantic search
      await this.addEntityToVectorStore(entity);

      // Trigger insight detection
      if (this.config.autoDetectInsights) {
        this.detectInsightsForEntity(entity);
      }

      this.logger.info('Knowledge entity created', {
        entityId: entity.id,
        entityType: entity.entityType,
        name: entity.name
      });

      return entity;
    } catch (error) {
      this.logger.error('Failed to create knowledge entity', error);
      throw error;
    }
  }

  /**
   * Create a relationship between entities
   */
  async createRelationship(data: NewKnowledgeRelationship): Promise<KnowledgeRelationship> {
    try {
      const validatedData = insertKnowledgeRelationshipSchema.parse({
        ...data,
        id: data.id || randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Insert into SQLite
      const result = await this.db.drizzle
        .insert(knowledgeRelationships)
        .values(validatedData as any)
        .returning()
        .execute();

      const relationship = result[0] as KnowledgeRelationship;

      // Update entity importance scores based on new relationship
      await this.updateEntityImportanceScores(relationship);

      // Trigger insight detection
      if (this.config.autoDetectInsights) {
        this.detectInsightsForRelationship(relationship);
      }

      this.logger.info('Knowledge relationship created', {
        relationshipId: relationship.id,
        type: relationship.relationshipType,
        fromEntity: relationship.fromEntityId,
        toEntity: relationship.toEntityId
      });

      return relationship;
    } catch (error) {
      this.logger.error('Failed to create knowledge relationship', error);
      throw error;
    }
  }

  /**
   * Find entities by semantic search
   */
  async findEntitiesBySemanticSearch(
    repositoryPath: string,
    query: string,
    entityTypes?: EntityType[],
    limit: number = 10,
    threshold: number = 0.7
  ): Promise<KnowledgeEntity[]> {
    try {
      // Search in vector store
      const vectorResults = await this.vectorService.searchSimilar(
        this.KNOWLEDGE_GRAPH_COLLECTION,
        query,
        limit * 2, // Get more results to filter
        threshold
      );

      // Get entity IDs from vector results
      const entityIds = vectorResults.map(result => result.id);
      
      // Don't return empty if no vector results - this prevents semantic search from working
      // if (entityIds.length === 0) {
      //   return [];
      // }

      // Query SQLite for full entity data
      const conditions = [
        eq(knowledgeEntities.repositoryPath, repositoryPath)
      ];
      
      // Only add ID filter if we have IDs from vector search
      if (entityIds.length > 0) {
        conditions.push(or(...entityIds.map(id => eq(knowledgeEntities.id, id))));
      }

      if (entityTypes && entityTypes.length > 0) {
        conditions.push(or(...entityTypes.map(type => eq(knowledgeEntities.entityType, type))));
      }

      const entities = await this.db.drizzle
        .select()
        .from(knowledgeEntities)
        .where(and(...conditions))
        .orderBy(desc(knowledgeEntities.importanceScore))
        .limit(limit)
        .execute();

      // Update access counts
      await Promise.all(entities.map(entity => this.updateEntityAccess(entity.id)));

      return entities as KnowledgeEntity[];
    } catch (error) {
      this.logger.error('Failed to find entities by semantic search', error);
      throw error;
    }
  }

  /**
   * Find related entities through relationships
   */
  async findRelatedEntities(
    entityId: string,
    relationshipTypes?: RelationshipType[],
    maxDistance: number = 2
  ): Promise<EntityWithRelationships[]> {
    try {
      const relatedEntities = new Map<string, EntityWithRelationships>();
      const visited = new Set<string>();
      const queue = [{ entityId, distance: 0 }];

      while (queue.length > 0) {
        const { entityId: currentId, distance } = queue.shift()!;

        if (visited.has(currentId) || distance > maxDistance) {
          continue;
        }

        visited.add(currentId);

        // Get entity
        const entity = await this._getEntityById(currentId);
        if (!entity) continue;

        // Get relationships
        const relationships = await this.getEntityRelationships(currentId, relationshipTypes);
        
        relatedEntities.set(currentId, {
          ...entity,
          relationships,
          relatedEntities: []
        });

        // Add connected entities to queue
        if (distance < maxDistance) {
          relationships.forEach(rel => {
            const nextId = rel.fromEntityId === currentId ? rel.toEntityId : rel.fromEntityId;
            if (!visited.has(nextId)) {
              queue.push({ entityId: nextId, distance: distance + 1 });
            }
          });
        }
      }

      return Array.from(relatedEntities.values());
    } catch (error) {
      this.logger.error('Failed to find related entities', error);
      throw error;
    }
  }

  /**
   * Detect insights automatically
   */
  private async detectInsightsForEntity(entity: KnowledgeEntity): Promise<void> {
    try {
      // Detect patterns based on entity type
      const patterns = await this.detectPatterns(entity);
      
      // Detect correlations
      const correlations = await this.detectCorrelations(entity);

      // Create insights
      const insights = [...patterns, ...correlations];
      
      for (const insight of insights) {
        await this.createInsight(insight);
      }
    } catch (error) {
      this.logger.error('Failed to detect insights for entity', error);
    }
  }

  /**
   * Detect patterns in the knowledge graph
   */
  private async detectPatterns(entity: KnowledgeEntity): Promise<NewKnowledgeInsight[]> {
    const insights: NewKnowledgeInsight[] = [];

    try {
      // Error pattern detection
      if (entity.entityType === 'error') {
        const similarErrors = await this.findSimilarEntities(entity, 'error', 0.8);
        
        if (similarErrors.length >= 3) {
          insights.push({
            id: randomUUID(),
            repositoryPath: entity.repositoryPath,
            title: `Recurring Error Pattern: ${entity.name}`,
            description: `Pattern detected: ${similarErrors.length} similar errors found`,
            insightType: 'pattern',
            relatedEntities: [entity.id, ...similarErrors.map(e => e.id)],
            relatedRelationships: [],
            evidence: { similarErrors: similarErrors.length, threshold: 0.8 },
            confidence: Math.min(0.9, 0.5 + (similarErrors.length * 0.1)),
            impact: 0.8,
            actionability: 0.9,
            discoveredBy: 'system',
            discoveredDuring: 'pattern_detection'
          });
        }
      }

      // Solution pattern detection
      if (entity.entityType === 'solution') {
        const appliedTo = await this.getRelatedEntities(entity.id, ['solution_applies_to']);
        
        if (appliedTo.length >= 2) {
          insights.push({
            id: randomUUID(),
            repositoryPath: entity.repositoryPath,
            title: `Reusable Solution Pattern: ${entity.name}`,
            description: `Solution successfully applied to ${appliedTo.length} problems`,
            insightType: 'pattern',
            relatedEntities: [entity.id, ...appliedTo.map(e => e.id)],
            relatedRelationships: [],
            evidence: { applicationsCount: appliedTo.length },
            confidence: 0.8,
            impact: 0.7,
            actionability: 0.8,
            discoveredBy: 'system',
            discoveredDuring: 'pattern_detection'
          });
        }
      }

      return insights;
    } catch (error) {
      this.logger.error('Failed to detect patterns', error);
      return [];
    }
  }

  /**
   * Detect correlations in the knowledge graph
   */
  private async detectCorrelations(entity: KnowledgeEntity): Promise<NewKnowledgeInsight[]> {
    const insights: NewKnowledgeInsight[] = [];

    try {
      // Tool usage correlation
      if (entity.entityType === 'tool') {
        const coUsedTools = await this.findCorrelatedTools(entity.id);
        
        if (coUsedTools.length > 0) {
          insights.push({
            id: randomUUID(),
            repositoryPath: entity.repositoryPath,
            title: `Tool Usage Correlation: ${entity.name}`,
            description: `Often used together with: ${coUsedTools.map(t => t.name).join(', ')}`,
            insightType: 'correlation',
            relatedEntities: [entity.id, ...coUsedTools.map(t => t.id)],
            relatedRelationships: [],
            evidence: { correlatedTools: coUsedTools.length },
            confidence: 0.7,
            impact: 0.6,
            actionability: 0.7,
            discoveredBy: 'system',
            discoveredDuring: 'correlation_detection'
          });
        }
      }

      return insights;
    } catch (error) {
      this.logger.error('Failed to detect correlations', error);
      return [];
    }
  }

  /**
   * Add entity to vector store
   */
  private async addEntityToVectorStore(entity: KnowledgeEntity): Promise<void> {
    try {
      // Ensure collection exists before adding
      try {
        await this.vectorService.getOrCreateCollection(this.KNOWLEDGE_GRAPH_COLLECTION, {
          type: 'knowledge_graph',
          embeddingModel: this.config.embeddingModel,
          createdAt: new Date().toISOString()
        });
      } catch (collectionError) {
        this.logger.warn('Failed to ensure collection exists, attempting to add anyway', collectionError);
      }
      
      const content = `${entity.name} ${entity.description || ''} ${entity.entityType}`;
      
      const result = await this.vectorService.addDocuments(this.KNOWLEDGE_GRAPH_COLLECTION, [{
        id: entity.id,
        content,
        metadata: {
          entityType: entity.entityType,
          repositoryPath: entity.repositoryPath,
          importanceScore: entity.importanceScore,
          relevanceScore: entity.relevanceScore,
          confidenceScore: entity.confidenceScore,
          createdAt: entity.createdAt,
          discoveredBy: entity.discoveredBy,
          discoveredDuring: entity.discoveredDuring
        }
      }]);
      
      if (!result.success) {
        this.logger.error('Vector store add failed', { entityId: entity.id, error: result.error });
      } else {
        this.logger.debug('Entity added to vector store', { entityId: entity.id, entityName: entity.name });
      }
    } catch (error) {
      this.logger.error('Failed to add entity to vector store', { entityId: entity.id, error });
      // Don't throw - allow entity creation to succeed even if vector indexing fails
    }
  }

  /**
   * Public API methods for Memory compatibility
   */
  async getEntityById(id: string): Promise<KnowledgeEntity | null> {
    return await this._getEntityById(id);
  }

  async updateEntity(id: string, data: any): Promise<void> {
    try {
      await this.db.drizzle
        .update(knowledgeEntities)
        .set({
          ...data,
          updatedAt: new Date().toISOString()
        })
        .where(eq(knowledgeEntities.id, id))
        .execute();
    } catch (error) {
      this.logger.error('Failed to update entity', { id, error });
      throw error;
    }
  }

  async deleteEntity(id: string): Promise<void> {
    try {
      await this.db.drizzle
        .delete(knowledgeEntities)
        .where(eq(knowledgeEntities.id, id))
        .execute();
    } catch (error) {
      this.logger.error('Failed to delete entity', { id, error });
      throw error;
    }
  }

  async findEntitiesByAgent(agentId: string, repositoryPath?: string, limit = 100): Promise<KnowledgeEntity[]> {
    try {
      const conditions = [
        like(knowledgeEntities.discoveredBy, agentId)
      ];

      if (repositoryPath) {
        conditions.push(eq(knowledgeEntities.repositoryPath, repositoryPath));
      }

      const result = await this.db.drizzle
        .select()
        .from(knowledgeEntities)
        .where(and(...conditions))
        .limit(limit)
        .execute();

      return result as KnowledgeEntity[];
    } catch (error) {
      this.logger.error('Failed to find entities by agent', { agentId, repositoryPath, error });
      throw error;
    }
  }

  async findEntitiesByType(entityType: EntityType, repositoryPath?: string, limit = 100): Promise<KnowledgeEntity[]> {
    try {
      const conditions = [
        eq(knowledgeEntities.entityType, entityType)
      ];

      if (repositoryPath) {
        conditions.push(eq(knowledgeEntities.repositoryPath, repositoryPath));
      }

      const result = await this.db.drizzle
        .select()
        .from(knowledgeEntities)
        .where(and(...conditions))
        .limit(limit)
        .execute();

      return result as KnowledgeEntity[];
    } catch (error) {
      this.logger.error('Failed to find entities by type', { entityType, repositoryPath, error });
      throw error;
    }
  }

  async findEntitiesByTags(tags: string[], repositoryPath?: string, limit = 100): Promise<KnowledgeEntity[]> {
    try {
      const conditions = [];
      
      if (repositoryPath) {
        conditions.push(eq(knowledgeEntities.repositoryPath, repositoryPath));
      }

      // Search for tags in properties
      const tagConditions = tags.map(tag => 
        like(knowledgeEntities.properties, `%"${tag}"%`)
      );
      
      if (tagConditions.length > 0) {
        conditions.push(or(...tagConditions));
      }

      const result = await this.db.drizzle
        .select()
        .from(knowledgeEntities)
        .where(and(...conditions))
        .limit(limit)
        .execute();

      return result as KnowledgeEntity[];
    } catch (error) {
      this.logger.error('Failed to find entities by tags', { tags, repositoryPath, error });
      throw error;
    }
  }

  /**
   * Find entities by basic text search
   */
  async findEntitiesByTextSearch(
    repositoryPath: string,
    query: string,
    entityTypes?: EntityType[],
    limit: number = 10
  ): Promise<KnowledgeEntity[]> {
    try {
      const searchTerm = `%${query.toLowerCase()}%`;
      const conditions: any[] = [
        eq(knowledgeEntities.repositoryPath, repositoryPath),
        or(
          sql`LOWER(${knowledgeEntities.name}) LIKE ${searchTerm}`,
          sql`LOWER(${knowledgeEntities.description}) LIKE ${searchTerm}`
        )
      ];

      if (entityTypes && entityTypes.length > 0) {
        conditions.push(or(...entityTypes.map(type => eq(knowledgeEntities.entityType, type))));
      }

      const entities = await this.db.drizzle
        .select()
        .from(knowledgeEntities)
        .where(and(...conditions))
        .orderBy(desc(knowledgeEntities.importanceScore))
        .limit(limit)
        .execute();

      return entities as KnowledgeEntity[];
    } catch (error) {
      this.logger.error('Failed to find entities by text search', { query, repositoryPath, error });
      throw error;
    }
  }

  async findEntitiesByRepository(repositoryPath: string, options: { entityType?: EntityType; limit?: number } = {}): Promise<KnowledgeEntity[]> {
    try {
      const conditions = [
        eq(knowledgeEntities.repositoryPath, repositoryPath)
      ];

      if (options.entityType) {
        conditions.push(eq(knowledgeEntities.entityType, options.entityType));
      }

      const result = await this.db.drizzle
        .select()
        .from(knowledgeEntities)
        .where(and(...conditions))
        .limit(options.limit || 100)
        .execute();

      return result as KnowledgeEntity[];
    } catch (error) {
      this.logger.error('Failed to find entities by repository', { repositoryPath, options, error });
      throw error;
    }
  }

  /**
   * Helper methods
   */
  private async _getEntityById(id: string): Promise<KnowledgeEntity | null> {
    try {
      const result = await this.db.drizzle
        .select()
        .from(knowledgeEntities)
        .where(eq(knowledgeEntities.id, id))
        .limit(1)
        .execute();

      return result[0] as KnowledgeEntity || null;
    } catch (error) {
      this.logger.error('Failed to get entity by ID', error);
      return null;
    }
  }

  private async getEntityRelationships(
    entityId: string,
    relationshipTypes?: RelationshipType[]
  ): Promise<KnowledgeRelationship[]> {
    try {
      const conditions = [
        or(
          eq(knowledgeRelationships.fromEntityId, entityId),
          eq(knowledgeRelationships.toEntityId, entityId)
        )
      ];

      if (relationshipTypes && relationshipTypes.length > 0) {
        conditions.push(or(...relationshipTypes.map(type => 
          eq(knowledgeRelationships.relationshipType, type)
        )));
      }

      const result = await this.db.drizzle
        .select()
        .from(knowledgeRelationships)
        .where(and(...conditions))
        .execute();

      return result as KnowledgeRelationship[];
    } catch (error) {
      this.logger.error('Failed to get entity relationships', error);
      return [];
    }
  }

  private async updateEntityAccess(entityId: string): Promise<void> {
    try {
      await this.db.drizzle
        .update(knowledgeEntities)
        .set({
          accessCount: sql`${knowledgeEntities.accessCount} + 1`,
          lastAccessed: new Date().toISOString()
        })
        .where(eq(knowledgeEntities.id, entityId))
        .execute();
    } catch (error) {
      this.logger.error('Failed to update entity access', error);
    }
  }

  private async updateEntityImportanceScores(relationship: KnowledgeRelationship): Promise<void> {
    // Update importance scores based on relationship strength and type
    // This is a simplified implementation
    const importanceBoost = relationship.strength * 0.1;
    
    await Promise.all([
      this.db.drizzle
        .update(knowledgeEntities)
        .set({ importanceScore: sql`${knowledgeEntities.importanceScore} + ${importanceBoost}` })
        .where(eq(knowledgeEntities.id, relationship.fromEntityId))
        .execute(),
      this.db.drizzle
        .update(knowledgeEntities)
        .set({ importanceScore: sql`${knowledgeEntities.importanceScore} + ${importanceBoost}` })
        .where(eq(knowledgeEntities.id, relationship.toEntityId))
        .execute()
    ]);
  }

  private async findSimilarEntities(
    entity: KnowledgeEntity,
    entityType: EntityType,
    threshold: number
  ): Promise<KnowledgeEntity[]> {
    return await this.findEntitiesBySemanticSearch(
      entity.repositoryPath,
      `${entity.name} ${entity.description || ''}`,
      [entityType],
      10,
      threshold
    );
  }

  private async getRelatedEntities(
    entityId: string,
    relationshipTypes: RelationshipType[]
  ): Promise<KnowledgeEntity[]> {
    const relationships = await this.getEntityRelationships(entityId, relationshipTypes);
    const relatedIds = relationships.map(rel => 
      rel.fromEntityId === entityId ? rel.toEntityId : rel.fromEntityId
    );

    if (relatedIds.length === 0) return [];

    const result = await this.db.drizzle
      .select()
      .from(knowledgeEntities)
      .where(or(...relatedIds.map(id => eq(knowledgeEntities.id, id))))
      .execute();

    return result as KnowledgeEntity[];
  }

  private async findCorrelatedTools(toolId: string): Promise<KnowledgeEntity[]> {
    // This is a simplified implementation
    // In a real system, you'd analyze usage patterns
    return [];
  }

  private async createInsight(data: NewKnowledgeInsight): Promise<KnowledgeInsight> {
    const validatedData = insertKnowledgeInsightSchema.parse({
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await this.db.drizzle
      .insert(knowledgeInsights)
      .values(validatedData as any)
      .returning()
      .execute();

    return result[0] as KnowledgeInsight;
  }

  private async detectInsightsForRelationship(relationship: KnowledgeRelationship): Promise<void> {
    // Implementation for relationship-based insight detection
    // This would analyze relationship patterns and create insights
  }

  private startInsightDetection(): void {
    setInterval(async () => {
      try {
        // Periodic insight detection across the entire graph
        await this.runGlobalInsightDetection();
      } catch (error) {
        this.logger.error('Failed during periodic insight detection', error);
      }
    }, this.config.insightDetectionInterval);
  }

  private async runGlobalInsightDetection(): Promise<void> {
    // Implementation for global insight detection
    // This would analyze the entire knowledge graph for patterns
  }

  /**
   * Get knowledge graph statistics
   */
  async getStats(repositoryPath: string): Promise<KnowledgeGraphStats> {
    try {
      const entities = await this.db.drizzle
        .select()
        .from(knowledgeEntities)
        .where(eq(knowledgeEntities.repositoryPath, repositoryPath))
        .execute();

      const relationships = await this.db.drizzle
        .select()
        .from(knowledgeRelationships)
        .where(eq(knowledgeRelationships.repositoryPath, repositoryPath))
        .execute();

      const insights = await this.db.drizzle
        .select()
        .from(knowledgeInsights)
        .where(eq(knowledgeInsights.repositoryPath, repositoryPath))
        .execute();

      // Calculate statistics
      const entitiesByType = {} as Record<EntityType, number>;
      const relationshipsByType = {} as Record<RelationshipType, number>;

      entities.forEach(entity => {
        entitiesByType[entity.entityType as EntityType] = (entitiesByType[entity.entityType as EntityType] || 0) + 1;
      });

      relationships.forEach(rel => {
        relationshipsByType[rel.relationshipType as RelationshipType] = (relationshipsByType[rel.relationshipType as RelationshipType] || 0) + 1;
      });

      const topEntitiesByImportance = entities
        .sort((a, b) => b.importanceScore - a.importanceScore)
        .slice(0, 10) as KnowledgeEntity[];

      const recentInsights = insights
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10) as KnowledgeInsight[];

      return {
        totalEntities: entities.length,
        totalRelationships: relationships.length,
        totalInsights: insights.length,
        entitiesByType,
        relationshipsByType,
        topEntitiesByImportance,
        recentInsights
      };
    } catch (error) {
      this.logger.error('Failed to get knowledge graph stats', error);
      throw error;
    }
  }

  // Wrapper methods for tool compatibility

  async searchEntities(
    query: string,
    options: {
      limit?: number;
      threshold?: number;
      entity_types?: EntityType[];
      include_relationships?: boolean;
      repositoryPath?: string;
    } = {}
  ): Promise<EntityWithRelationships[]> {
    if (!options.repositoryPath) {
      throw new Error('repositoryPath is required for searchEntities');
    }

    // Call findEntitiesBySemanticSearch with correct parameters
    const entities = await this.findEntitiesBySemanticSearch(
      options.repositoryPath,
      query,
      options.entity_types,
      options.limit || 20,
      options.threshold ?? 0.7
    );

    // Convert to EntityWithRelationships format
    if (options.include_relationships !== false) {
      // Get relationships for each entity
      const results: EntityWithRelationships[] = await Promise.all(
        entities.map(async (entity) => {
          const relationships = await this.getEntityRelationships(entity.id);
          return {
            ...entity,
            relationships: relationships || [],
            relatedEntities: []
          };
        })
      );
      return results;
    } else {
      // Return without relationships
      return entities.map(entity => ({
        ...entity,
        relationships: [],
        relatedEntities: []
      }));
    }
  }

  async getEntity(id: string): Promise<KnowledgeEntity | null> {
    return this.getEntityById(id);
  }

  async getAllEntities(repositoryPath?: string): Promise<KnowledgeEntity[]> {
    try {
      let query = this.db.drizzle
        .select()
        .from(knowledgeEntities);

      if (repositoryPath) {
        query = query.where(eq(knowledgeEntities.repositoryPath, repositoryPath)) as any;
      }

      const result = await query.all();
      return result as KnowledgeEntity[];
    } catch (error) {
      this.logger.error('Failed to get all entities', error);
      throw error;
    }
  }

  async getAllRelationships(repositoryPath?: string): Promise<KnowledgeRelationship[]> {
    try {
      let query = this.db.drizzle
        .select()
        .from(knowledgeRelationships);

      if (repositoryPath) {
        query = query.where(eq(knowledgeRelationships.repositoryPath, repositoryPath)) as any;
      }

      const result = await query.all();
      return result as KnowledgeRelationship[];
    } catch (error) {
      this.logger.error('Failed to get all relationships', error);
      throw error;
    }
  }

  async wipeAllData(repositoryPath: string): Promise<void> {
    try {
      // Delete in order: insights, relationships, entities
      await this.db.drizzle
        .delete(knowledgeInsights)
        .where(eq(knowledgeInsights.repositoryPath, repositoryPath))
        .execute();

      await this.db.drizzle
        .delete(knowledgeRelationships)
        .where(eq(knowledgeRelationships.repositoryPath, repositoryPath))
        .execute();

      await this.db.drizzle
        .delete(knowledgeEntities)
        .where(eq(knowledgeEntities.repositoryPath, repositoryPath))
        .execute();

      this.logger.info(`Wiped all knowledge graph data for ${repositoryPath}`);
    } catch (error) {
      this.logger.error('Failed to wipe knowledge graph data', error);
      throw error;
    }
  }

  async initialize(): Promise<void> {
    return this.initializeService();
  }

  async getCollectionStats(repositoryPath?: string): Promise<{
    totalEntities: number;
    totalRelationships: number;
    entitiesByType: Record<string, number>;
  }> {
    try {
      const entities = await this.getAllEntities(repositoryPath);
      const relationships = await this.getAllRelationships(repositoryPath);

      const entitiesByType: Record<string, number> = {};
      for (const entity of entities) {
        entitiesByType[entity.entityType] = (entitiesByType[entity.entityType] || 0) + 1;
      }

      return {
        totalEntities: entities.length,
        totalRelationships: relationships.length,
        entitiesByType
      };
    } catch (error) {
      this.logger.error('Failed to get collection stats', error);
      throw error;
    }
  }
}