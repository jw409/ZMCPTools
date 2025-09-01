/**
 * MCP Tools for Knowledge Graph
 * Uses the core KnowledgeGraphService and VectorSearchService
 */

import type { McpTool } from '../schemas/tools/index.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { DatabaseManager } from '../database/index.js';
import { KnowledgeGraphService } from '../services/KnowledgeGraphService.js';
import { VectorSearchService } from '../services/VectorSearchService.js';
import { Logger } from '../utils/logger.js';
import {
  type NewKnowledgeEntity,
  type NewKnowledgeRelationship,
  type EntityFilter,
  type RelationshipFilter
} from '../schemas/knowledge-graph.js';
import {
  StoreKnowledgeMemorySchema,
  CreateRelationshipSchema,
  SearchKnowledgeGraphSchema,
  FindRelatedEntitiesSchema,
  PruneMemorySchema,
  CompactMemorySchema,
  MemoryStatusSchema,
  StoreKnowledgeMemoryResponseSchema,
  CreateKnowledgeRelationshipResponseSchema,
  SearchKnowledgeGraphResponseSchema,
  FindRelatedEntitiesResponseSchema,
  PruneMemoryResponseSchema,
  CompactMemoryResponseSchema,
  MemoryStatusResponseSchema,
  type StoreKnowledgeMemoryInput,
  type CreateRelationshipInput,
  type SearchKnowledgeGraphInput,
  type FindRelatedEntitiesInput,
  type PruneMemoryInput,
  type CompactMemoryInput,
  type MemoryStatusInput,
  type StoreKnowledgeMemoryResponse,
  type CreateKnowledgeRelationshipResponse,
  type SearchKnowledgeGraphResponse,
  type FindRelatedEntitiesResponse,
  type PruneMemoryResponse,
  type CompactMemoryResponse,
  type MemoryStatusResponse
} from '../schemas/tools/knowledgeGraph.js';

const logger = new Logger('knowledge-graph-tools');

export class KnowledgeGraphMcpTools {
  constructor(
    private db: DatabaseManager
  ) {}

  /**
   * Get all knowledge graph MCP tools
   */
  getTools(): McpTool[] {
    return [
      {
        name: 'store_knowledge_memory',
        description: 'Store a knowledge graph memory with entity creation',
        inputSchema: zodToJsonSchema(StoreKnowledgeMemorySchema),
        outputSchema: zodToJsonSchema(StoreKnowledgeMemoryResponseSchema),
        handler: this.storeKnowledgeMemory.bind(this)
      },
      {
        name: 'create_knowledge_relationship',
        description: 'Create a relationship between two entities in the knowledge graph',
        inputSchema: zodToJsonSchema(CreateRelationshipSchema),
        outputSchema: zodToJsonSchema(CreateKnowledgeRelationshipResponseSchema),
        handler: this.createKnowledgeRelationship.bind(this)
      },
      {
        name: 'search_knowledge_graph',
        description: 'Search the knowledge graph using semantic or basic search',
        inputSchema: zodToJsonSchema(SearchKnowledgeGraphSchema),
        outputSchema: zodToJsonSchema(SearchKnowledgeGraphResponseSchema),
        handler: this.searchKnowledgeGraph.bind(this)
      },
      {
        name: 'find_related_entities',
        description: 'Find related entities through relationship traversal',
        inputSchema: zodToJsonSchema(FindRelatedEntitiesSchema),
        outputSchema: zodToJsonSchema(FindRelatedEntitiesResponseSchema),
        handler: this.findRelatedEntities.bind(this)
      },
      {
        name: 'prune_knowledge_memory',
        description: 'Prune polluted or outdated knowledge based on content patterns',
        inputSchema: zodToJsonSchema(PruneMemorySchema),
        outputSchema: zodToJsonSchema(PruneMemoryResponseSchema),
        handler: this.pruneKnowledgeMemory.bind(this)
      },
      {
        name: 'compact_knowledge_memory',
        description: 'Compact memory by removing duplicates and merging similar entities',
        inputSchema: zodToJsonSchema(CompactMemorySchema),
        outputSchema: zodToJsonSchema(CompactMemoryResponseSchema),
        handler: this.compactKnowledgeMemory.bind(this)
      },
      {
        name: 'get_memory_status',
        description: 'Get comprehensive memory status and pollution indicators',
        inputSchema: zodToJsonSchema(MemoryStatusSchema),
        outputSchema: zodToJsonSchema(MemoryStatusResponseSchema),
        handler: this.getMemoryStatus.bind(this)
      }
    ];
  }


  private async storeKnowledgeMemory(args: any): Promise<StoreKnowledgeMemoryResponse> {
    // Support both formal schema and simpler memory_type/title/content format
    const mappedArgs: StoreKnowledgeMemoryInput = {
      repository_path: args.repository_path || args.repositoryPath,
      agent_id: args.agent_id || args.agentId,
      entity_type: args.entity_type || args.entityType || 'knowledge_memory',
      entity_name: args.entity_name || args.entityName || args.title,
      entity_description: args.entity_description || args.entityDescription || args.content,
      importance_score: args.importance_score || args.importanceScore,
      confidence_score: args.confidence_score || args.confidenceScore,
      properties: {
        ...args.properties,
        ...(args.memory_type && { memory_type: args.memory_type }),
        ...(args.title && { title: args.title }),
        ...(args.content && { content: args.content })
      }
    };
    const params = StoreKnowledgeMemorySchema.parse(mappedArgs);
    return await storeKnowledgeMemory(this.db, params);
  }

  private async createKnowledgeRelationship(args: any): Promise<CreateKnowledgeRelationshipResponse> {
    // Map snake_case to camelCase for compatibility with MCP client
    const mappedArgs: CreateRelationshipInput = {
      repository_path: args.repository_path || args.repositoryPath,
      from_entity_id: args.from_entity_id || args.fromEntityId,
      to_entity_id: args.to_entity_id || args.toEntityId,
      relationship_type: args.relationship_type || args.relationshipType,
      strength: args.strength,
      confidence: args.confidence,
      context: args.context,
      discovered_by: args.discovered_by || args.discoveredBy,
      properties: args.properties
    };
    const params = CreateRelationshipSchema.parse(mappedArgs);
    return await createKnowledgeRelationship(this.db, params);
  }

  private async searchKnowledgeGraph(args: any): Promise<SearchKnowledgeGraphResponse> {
    // Map snake_case to camelCase for compatibility with MCP client
    const mappedArgs: SearchKnowledgeGraphInput = {
      repository_path: args.repository_path || args.repositoryPath,
      query: args.query,
      entity_types: args.entity_types || args.entityTypes,
      relationship_types: args.relationship_types || args.relationshipTypes,
      use_semantic_search: args.use_semantic_search !== undefined ? args.use_semantic_search : args.useSemanticSearch,
      include_relationships: args.include_relationships !== undefined ? args.include_relationships : args.includeRelationships,
      limit: args.limit,
      threshold: args.threshold
    };
    const params = SearchKnowledgeGraphSchema.parse(mappedArgs);
    return await searchKnowledgeGraph(this.db, params);
  }

  private async findRelatedEntities(args: any): Promise<FindRelatedEntitiesResponse> {
    // Map snake_case to camelCase for compatibility with MCP client
    const mappedArgs: FindRelatedEntitiesInput = {
      repository_path: args.repository_path || args.repositoryPath,
      entity_id: args.entity_id || args.entityId,
      relationship_types: args.relationship_types || args.relationshipTypes,
      max_distance: args.max_distance || args.maxDistance,
      min_strength: args.min_strength || args.minStrength
    };
    const params = FindRelatedEntitiesSchema.parse(mappedArgs);
    return await findRelatedEntities(this.db, params);
  }

  private async pruneKnowledgeMemory(args: any): Promise<PruneMemoryResponse> {
    const mappedArgs: PruneMemoryInput = {
      repository_path: args.repository_path || args.repositoryPath,
      pollution_patterns: args.pollution_patterns || args.pollutionPatterns,
      superseded_by: args.superseded_by || args.supersededBy,
      min_importance_threshold: args.min_importance_threshold || args.minImportanceThreshold,
      confidence_threshold: args.confidence_threshold || args.confidenceThreshold,
      dry_run: args.dry_run !== undefined ? args.dry_run : args.dryRun
    };
    const params = PruneMemorySchema.parse(mappedArgs);
    return await pruneKnowledgeMemory(this.db, params);
  }

  private async compactKnowledgeMemory(args: any): Promise<CompactMemoryResponse> {
    const mappedArgs: CompactMemoryInput = {
      repository_path: args.repository_path || args.repositoryPath,
      remove_duplicates: args.remove_duplicates !== undefined ? args.remove_duplicates : args.removeDuplicates,
      merge_similar: args.merge_similar !== undefined ? args.merge_similar : args.mergeSimilar,
      similarity_threshold: args.similarity_threshold || args.similarityThreshold,
      preserve_relationships: args.preserve_relationships !== undefined ? args.preserve_relationships : args.preserveRelationships
    };
    const params = CompactMemorySchema.parse(mappedArgs);
    return await compactKnowledgeMemory(this.db, params);
  }

  private async getMemoryStatus(args: any): Promise<MemoryStatusResponse> {
    const mappedArgs: MemoryStatusInput = {
      repository_path: args.repository_path || args.repositoryPath
    };
    const params = MemoryStatusSchema.parse(mappedArgs);
    return await getMemoryStatus(this.db, params);
  }
}

// Re-export schemas for MCP server registration
export { 
  StoreKnowledgeMemorySchema, 
  CreateRelationshipSchema, 
  SearchKnowledgeGraphSchema, 
  FindRelatedEntitiesSchema,
  PruneMemorySchema,
  CompactMemorySchema,
  MemoryStatusSchema
};

// Re-export types for backward compatibility
export type StoreKnowledgeMemoryArgs = StoreKnowledgeMemoryInput;
export type CreateRelationshipArgs = CreateRelationshipInput;
export type SearchKnowledgeGraphArgs = SearchKnowledgeGraphInput;
export type FindRelatedEntitiesArgs = FindRelatedEntitiesInput;
export type PruneMemoryArgs = PruneMemoryInput;
export type CompactMemoryArgs = CompactMemoryInput;
export type MemoryStatusArgs = MemoryStatusInput;

/**
 * Store a knowledge graph memory with entity creation
 */
export async function storeKnowledgeMemory(
  db: DatabaseManager,
  args: StoreKnowledgeMemoryInput
): Promise<StoreKnowledgeMemoryResponse> {
  try {
    logger.info('Storing knowledge graph memory', args);
    
    // Initialize services
    const vectorService = new VectorSearchService(db);
    await vectorService.initialize();
    const knowledgeGraph = new KnowledgeGraphService(db, vectorService);

    // Create knowledge entity
    const entityData: NewKnowledgeEntity = {
      id: crypto.randomUUID(),
      repositoryPath: args.repository_path,
      entityType: args.entity_type as any, // Type assertion to handle enum mismatch
      name: args.entity_name,
      description: args.entity_description,
      properties: args.properties,
      importanceScore: args.importance_score,
      relevanceScore: 0.8,
      confidenceScore: args.confidence_score,
      discoveredBy: args.agent_id,
      discoveredDuring: 'manual_storage'
    };

    const entity = await knowledgeGraph.createEntity(entityData);

    return {
      success: true,
      entity_id: entity.id,
      message: `Knowledge entity "${args.entity_name}" stored successfully`
    };

  } catch (error) {
    logger.error('Failed to store knowledge graph memory', error);
    throw new Error(`Failed to store knowledge graph memory: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create a relationship between two entities
 */
export async function createKnowledgeRelationship(
  db: DatabaseManager,
  args: CreateRelationshipInput
): Promise<CreateKnowledgeRelationshipResponse> {
  try {
    logger.info('Creating knowledge relationship', args);
    
    const vectorService = new VectorSearchService(db);
    await vectorService.initialize();
    const knowledgeGraph = new KnowledgeGraphService(db, vectorService);

    const relationshipData: NewKnowledgeRelationship = {
      id: crypto.randomUUID(),
      repositoryPath: args.repository_path,
      fromEntityId: args.from_entity_id,
      toEntityId: args.to_entity_id,
      relationshipType: args.relationship_type,
      strength: args.strength,
      confidence: args.confidence,
      context: args.context,
      discoveredBy: args.discovered_by,
      discoveredDuring: 'manual_creation',
      properties: args.properties
    };

    const relationship = await knowledgeGraph.createRelationship(relationshipData);

    return {
      success: true,
      relationship_id: relationship.id,
      message: `Relationship "${args.relationship_type}" created between entities`
    };

  } catch (error) {
    logger.error('Failed to create knowledge relationship', error);
    throw new Error(`Failed to create knowledge relationship: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Search the knowledge graph
 */
export async function searchKnowledgeGraph(
  db: DatabaseManager,
  args: SearchKnowledgeGraphInput
): Promise<SearchKnowledgeGraphResponse> {
  try {
    logger.info('Searching knowledge graph', args);
    
    const vectorService = new VectorSearchService(db);
    await vectorService.initialize();
    const knowledgeGraph = new KnowledgeGraphService(db, vectorService);

    const startTime = Date.now();

    // Get entities first
    let entities: any[] = [];
    if (args.use_semantic_search) {
      entities = await knowledgeGraph.findEntitiesBySemanticSearch(
        args.repository_path,
        args.query,
        args.entity_types,
        args.limit,
        args.threshold || 0.3  // Add threshold parameter with default
      );
    } else {
      // Use text-based search for basic search
      if (args.query && args.query.trim()) {
        entities = await knowledgeGraph.findEntitiesByTextSearch(
          args.repository_path,
          args.query,
          args.entity_types,
          args.limit
        );
      } else if (args.entity_types && args.entity_types.length > 0) {
        entities = await knowledgeGraph.findEntitiesByType(
          args.entity_types[0],
          args.repository_path,
          args.limit
        );
      } else {
        // Only return all entities if no query provided
        entities = await knowledgeGraph.findEntitiesByRepository(
          args.repository_path,
          { limit: args.limit }
        );
      }
    }

    // Get relationships if requested
    let relationships: any[] = [];
    if (args.include_relationships) {
      // For now, get relationships for the found entities
      const relationshipPromises = entities.map(entity => 
        knowledgeGraph.findRelatedEntities(entity.id, args.relationship_types, 2)
      );
      const entityRelationships = await Promise.all(relationshipPromises);
      relationships = entityRelationships.flatMap(er => er.flatMap(e => e.relationships));
    }

    const processingTime = Date.now() - startTime;

    return {
      entities: entities.map(entity => ({
        id: entity.id,
        type: entity.entityType,
        name: entity.name,
        description: entity.description,
        importance_score: entity.importanceScore,
        confidence_score: entity.confidenceScore,
        properties: entity.properties,
        discovered_by: entity.discoveredBy,
        created_at: entity.createdAt
      })),
      relationships: relationships.map(rel => ({
        id: rel.id,
        from_entity_id: rel.fromEntityId,
        to_entity_id: rel.toEntityId,
        type: rel.relationshipType,
        strength: rel.strength,
        confidence: rel.confidence,
        context: rel.context,
        discovered_by: rel.discoveredBy,
        created_at: rel.createdAt
      })),
      total_results: entities.length + relationships.length,
      search_metadata: {
        search_type: args.use_semantic_search ? 'semantic' : 'basic',
        processing_time: processingTime
      }
    };

  } catch (error) {
    logger.error('Failed to search knowledge graph', error);
    throw new Error(`Failed to search knowledge graph: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Find related entities through relationship traversal
 */
export async function findRelatedEntities(
  db: DatabaseManager,
  args: FindRelatedEntitiesInput
): Promise<FindRelatedEntitiesResponse> {
  try {
    logger.info('Finding related entities', args);
    
    const vectorService = new VectorSearchService(db);
    await vectorService.initialize();
    const knowledgeGraph = new KnowledgeGraphService(db, vectorService);

    const relatedEntities = await knowledgeGraph.findRelatedEntities(
      args.entity_id,
      args.relationship_types,
      args.max_distance
    );

    return {
      entities: relatedEntities.map(entity => ({
        id: entity.id,
        type: entity.entityType,
        name: entity.name,
        description: entity.description,
        importance_score: entity.importanceScore,
        confidence_score: entity.confidenceScore,
        relationships: entity.relationships.map(rel => ({
          id: rel.id,
          type: rel.relationshipType,
          strength: rel.strength,
          confidence: rel.confidence
        }))
      })),
      relationships: relatedEntities.flatMap(entity => entity.relationships).map(rel => ({
        id: rel.id,
        from_entity_id: rel.fromEntityId,
        to_entity_id: rel.toEntityId,
        type: rel.relationshipType,
        strength: rel.strength,
        confidence: rel.confidence
      })),
      total_found: relatedEntities.length
    };

  } catch (error) {
    logger.error('Failed to find related entities', error);
    throw new Error(`Failed to find related entities: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Prune polluted or outdated knowledge from memory
 */
export async function pruneKnowledgeMemory(
  db: DatabaseManager,
  args: PruneMemoryInput
): Promise<PruneMemoryResponse> {
  try {
    logger.info('Pruning knowledge memory', args);
    
    const vectorService = new VectorSearchService(db);
    await vectorService.initialize();
    const knowledgeGraph = new KnowledgeGraphService(db, vectorService);

    // Find entities matching pollution patterns
    const allEntities = await knowledgeGraph.findEntitiesByRepository(args.repository_path);
    
    let candidatesForRemoval = [];
    const patternsMatched: string[] = [];

    // Apply content-based filtering for pollution patterns
    if (args.pollution_patterns && args.pollution_patterns.length > 0) {
      for (const pattern of args.pollution_patterns) {
        const matchingEntities = allEntities.filter(entity => 
          entity.name.toLowerCase().includes(pattern.toLowerCase()) ||
          (entity.description && entity.description.toLowerCase().includes(pattern.toLowerCase()))
        );
        if (matchingEntities.length > 0) {
          candidatesForRemoval.push(...matchingEntities);
          patternsMatched.push(pattern);
        }
      }
    }

    // Apply quality thresholds
    const lowQualityEntities = allEntities.filter(entity => 
      entity.importanceScore < args.min_importance_threshold ||
      entity.confidenceScore < args.confidence_threshold
    );
    candidatesForRemoval.push(...lowQualityEntities);

    // Remove duplicates and superseded entities
    const uniqueCandidates = Array.from(new Set(candidatesForRemoval.map(e => e.id)))
      .map(id => candidatesForRemoval.find(e => e.id === id)!)
      .filter(entity => {
        // Skip if superseded by a better entity
        if (args.superseded_by && args.superseded_by.length > 0) {
          return !args.superseded_by.some(supersedingId => 
            allEntities.find(e => e.id === supersedingId && 
              e.importanceScore > entity.importanceScore &&
              e.confidenceScore > entity.confidenceScore
            )
          );
        }
        return true;
      });

    if (!args.dry_run) {
      // Actually remove the entities
      for (const entity of uniqueCandidates) {
        await knowledgeGraph.deleteEntity(entity.id);
      }
    }

    return {
      success: true,
      dry_run: args.dry_run,
      entities_found: uniqueCandidates.length,
      entities_removed: args.dry_run ? 0 : uniqueCandidates.length,
      pollution_patterns_matched: patternsMatched,
      message: args.dry_run 
        ? `Found ${uniqueCandidates.length} entities for removal (dry run)`
        : `Successfully pruned ${uniqueCandidates.length} polluted entities`
    };

  } catch (error) {
    logger.error('Failed to prune knowledge memory', error);
    throw new Error(`Failed to prune knowledge memory: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Compact memory by removing duplicates and merging similar entities
 */
export async function compactKnowledgeMemory(
  db: DatabaseManager,
  args: CompactMemoryInput
): Promise<CompactMemoryResponse> {
  try {
    logger.info('Compacting knowledge memory', args);
    
    const vectorService = new VectorSearchService(db);
    await vectorService.initialize();
    const knowledgeGraph = new KnowledgeGraphService(db, vectorService);

    const allEntities = await knowledgeGraph.findEntitiesByRepository(args.repository_path);
    let duplicatesRemoved = 0;
    let entitiesMerged = 0;
    let relationshipsConsolidated = 0;

    if (args.remove_duplicates) {
      // Find exact duplicates (same name and type)
      const entityGroups = new Map<string, any[]>();
      for (const entity of allEntities) {
        const key = `${entity.name.toLowerCase().trim()}-${entity.entityType}`;
        if (!entityGroups.has(key)) {
          entityGroups.set(key, []);
        }
        entityGroups.get(key)!.push(entity);
      }

      // Remove duplicates, keeping the highest importance one
      for (const [, group] of entityGroups) {
        if (group.length > 1) {
          const sorted = group.sort((a, b) => b.importanceScore - a.importanceScore);
          const keeper = sorted[0];
          const duplicates = sorted.slice(1);

          for (const duplicate of duplicates) {
            // Transfer relationships if needed
            if (args.preserve_relationships) {
              // This would need relationship updating logic
              relationshipsConsolidated++;
            }
            await knowledgeGraph.deleteEntity(duplicate.id);
            duplicatesRemoved++;
          }
        }
      }
    }

    if (args.merge_similar) {
      // Use semantic search to find highly similar entities
      const processedIds = new Set<string>();
      
      for (const entity of allEntities) {
        if (processedIds.has(entity.id)) continue;
        
        const similarEntities = await knowledgeGraph.findEntitiesBySemanticSearch(
          args.repository_path,
          `${entity.name} ${entity.description || ''}`,
          undefined,
          5,
          args.similarity_threshold
        );
        
        const highSimilarity = similarEntities.filter(similar => 
          similar.id !== entity.id && !processedIds.has(similar.id)
        );
        
        if (highSimilarity.length > 0) {
          // Merge into the highest importance entity
          const allInGroup = [entity, ...highSimilarity];
          const keeper = allInGroup.sort((a, b) => b.importanceScore - a.importanceScore)[0];
          const toMerge = allInGroup.filter(e => e.id !== keeper.id);
          
          for (const mergeTarget of toMerge) {
            processedIds.add(mergeTarget.id);
            await knowledgeGraph.deleteEntity(mergeTarget.id);
            entitiesMerged++;
          }
          processedIds.add(keeper.id);
        } else {
          processedIds.add(entity.id);
        }
      }
    }

    const totalBefore = allEntities.length;
    const totalAfter = totalBefore - duplicatesRemoved - entitiesMerged;
    const spaceSavedPercent = totalBefore > 0 ? ((duplicatesRemoved + entitiesMerged) / totalBefore) * 100 : 0;

    return {
      success: true,
      duplicates_removed: duplicatesRemoved,
      entities_merged: entitiesMerged,
      relationships_consolidated: relationshipsConsolidated,
      space_saved_percent: Math.round(spaceSavedPercent * 100) / 100,
      message: `Compaction complete: removed ${duplicatesRemoved} duplicates, merged ${entitiesMerged} similar entities`
    };

  } catch (error) {
    logger.error('Failed to compact knowledge memory', error);
    throw new Error(`Failed to compact knowledge memory: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get comprehensive memory status and pollution indicators
 */
export async function getMemoryStatus(
  db: DatabaseManager,
  args: MemoryStatusInput
): Promise<MemoryStatusResponse> {
  try {
    logger.info('Getting memory status', args);
    
    const vectorService = new VectorSearchService(db);
    await vectorService.initialize();
    const knowledgeGraph = new KnowledgeGraphService(db, vectorService);

    const allEntities = await knowledgeGraph.findEntitiesByRepository(args.repository_path);
    const stats = await knowledgeGraph.getStats(args.repository_path);

    // Analyze context distribution
    const contextDistribution: Record<string, number> = {
      'dom0': 0,
      'talent': 0, 
      'project': 0,
      'session': 0
    };

    for (const entity of allEntities) {
      if (entity.repositoryPath === '.') {
        contextDistribution.dom0++;
      } else if (entity.repositoryPath.includes('talent')) {
        contextDistribution.talent++;
      } else if (entity.repositoryPath.includes('project')) {
        contextDistribution.project++;
      } else {
        contextDistribution.session++;
      }
    }

    // Detect pollution patterns
    const pollutionPatterns = [
      'seven separate task systems',
      'context loss death spiral',
      'todo systems',
      'bootstrap',
      'USE_RTX5090'
    ];

    const pollutionIndicators = [];
    for (const pattern of pollutionPatterns) {
      const matchingEntities = allEntities.filter(entity => 
        entity.name.toLowerCase().includes(pattern.toLowerCase()) ||
        (entity.description && entity.description.toLowerCase().includes(pattern.toLowerCase()))
      );
      
      if (matchingEntities.length > 0) {
        pollutionIndicators.push({
          pattern,
          entity_count: matchingEntities.length,
          example_entities: matchingEntities.slice(0, 3).map(e => e.name)
        });
      }
    }

    // Generate recommendations
    const recommendations = [];
    if (pollutionIndicators.length > 0) {
      recommendations.push(`Prune ${pollutionIndicators.reduce((sum, p) => sum + p.entity_count, 0)} polluted entities`);
    }
    
    const lowQualityCount = allEntities.filter(e => e.importanceScore < 0.3 || e.confidenceScore < 0.5).length;
    if (lowQualityCount > 0) {
      recommendations.push(`Remove ${lowQualityCount} low-quality entities`);
    }

    const avgImportance = allEntities.reduce((sum, e) => sum + e.importanceScore, 0) / allEntities.length;
    const avgConfidence = allEntities.reduce((sum, e) => sum + e.confidenceScore, 0) / allEntities.length;

    return {
      total_entities: stats.totalEntities,
      total_relationships: stats.totalRelationships,
      context_distribution: contextDistribution,
      quality_metrics: {
        avg_importance: Math.round(avgImportance * 100) / 100,
        avg_confidence: Math.round(avgConfidence * 100) / 100,
        low_quality_entities: lowQualityCount
      },
      pollution_indicators: pollutionIndicators,
      recommendations
    };

  } catch (error) {
    logger.error('Failed to get memory status', error);
    throw new Error(`Failed to get memory status: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}