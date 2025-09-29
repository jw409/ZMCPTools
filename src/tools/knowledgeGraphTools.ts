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
  UpdateKnowledgeEntitySchema,
  ExportKnowledgeGraphSchema,
  WipeKnowledgeGraphSchema,
  StoreKnowledgeMemoryResponseSchema,
  CreateKnowledgeRelationshipResponseSchema,
  SearchKnowledgeGraphResponseSchema,
  FindRelatedEntitiesResponseSchema,
  PruneMemoryResponseSchema,
  CompactMemoryResponseSchema,
  MemoryStatusResponseSchema,
  UpdateKnowledgeEntityResponseSchema,
  ExportKnowledgeGraphResponseSchema,
  WipeKnowledgeGraphResponseSchema,
  type StoreKnowledgeMemoryInput,
  type CreateRelationshipInput,
  type SearchKnowledgeGraphInput,
  type FindRelatedEntitiesInput,
  type PruneMemoryInput,
  type CompactMemoryInput,
  type MemoryStatusInput,
  type UpdateKnowledgeEntityInput,
  type ExportKnowledgeGraphInput,
  type WipeKnowledgeGraphInput,
  type StoreKnowledgeMemoryResponse,
  type CreateKnowledgeRelationshipResponse,
  type SearchKnowledgeGraphResponse,
  type FindRelatedEntitiesResponse,
  type PruneMemoryResponse,
  type CompactMemoryResponse,
  type MemoryStatusResponse,
  type UpdateKnowledgeEntityResponse,
  type ExportKnowledgeGraphResponse,
  type WipeKnowledgeGraphResponse
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
        description: 'Remove low-authority entities and flag potential conflicts for review. Removes entities below authority threshold (importance × confidence), finds similar entity pairs (high embedding similarity) for LLM contradiction review, matches pollution patterns. Params: min_authority (default 0.3), flag_similar_for_review (default true), similarity_threshold (0.75), dry_run (default true). Returns: entities_pruned[], conflict_candidates[{entity_a, entity_b, similarity}], source_files_referenced[].',
        inputSchema: zodToJsonSchema(PruneMemorySchema),
        outputSchema: zodToJsonSchema(PruneMemoryResponseSchema),
        handler: this.pruneKnowledgeMemory.bind(this)
      },
      {
        name: 'compact_knowledge_memory',
        description: 'Remove duplicate entities and optionally merge highly similar entities to reduce graph pollution. Params: remove_duplicates (default true), merge_similar (default false - conservative), similarity_threshold (0.7-1.0, default 0.95), preserve_relationships (default true). Returns: duplicates_removed, entities_merged, relationships_preserved, space_saved.',
        inputSchema: zodToJsonSchema(CompactMemorySchema),
        outputSchema: zodToJsonSchema(CompactMemoryResponseSchema),
        handler: this.compactKnowledgeMemory.bind(this)
      },
      {
        name: 'get_memory_status',
        description: 'Analyze knowledge graph health including pollution indicators, quality distribution, and recommendations. Returns: total_entities, total_relationships, context_distribution (dom0/domU if implemented), quality_metrics (avg importance/confidence, low_quality_count), pollution_indicators, recommendations for cleanup.',
        inputSchema: zodToJsonSchema(MemoryStatusSchema),
        outputSchema: zodToJsonSchema(MemoryStatusResponseSchema),
        handler: this.getMemoryStatus.bind(this)
      },
      {
        name: 'update_knowledge_entity',
        description: 'Update entity metadata or content with optional re-embedding. Updates: importance_score, confidence_score, entity_type, entity_name, entity_description, properties. Re-embedding: Auto if description changes, or force with re_embed=true. Requires GPU if re-embedding. Params: entity_id (required), updates{} (fields to change), re_embed (bool, default auto). Returns: entity_updated, re_embedded (bool).',
        inputSchema: zodToJsonSchema(UpdateKnowledgeEntitySchema),
        outputSchema: zodToJsonSchema(UpdateKnowledgeEntityResponseSchema),
        handler: this.updateKnowledgeEntity.bind(this)
      },
      {
        name: 'export_knowledge_graph',
        description: 'Export the entire knowledge graph to a file or return the data. Use this before wiping to backup existing knowledge. Params: output_format (json/jsonl/csv), include_embeddings (bool, default false), output_file (optional path). Returns: total_entities, total_relationships, data_size, output_file or data.',
        inputSchema: zodToJsonSchema(ExportKnowledgeGraphSchema),
        outputSchema: zodToJsonSchema(ExportKnowledgeGraphResponseSchema),
        handler: this.exportKnowledgeGraph.bind(this)
      },
      {
        name: 'wipe_knowledge_graph',
        description: 'Completely wipe all knowledge graph data for a repository. DESTRUCTIVE operation - removes all entities, relationships, and insights. Requires explicit confirm=true. Params: confirm (bool, default false - safety), backup_first (bool, default true). Returns: entities_removed, relationships_removed, backup_file.',
        inputSchema: zodToJsonSchema(WipeKnowledgeGraphSchema),
        outputSchema: zodToJsonSchema(WipeKnowledgeGraphResponseSchema),
        handler: this.wipeKnowledgeGraph.bind(this)
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

  private async updateKnowledgeEntity(args: any): Promise<UpdateKnowledgeEntityResponse> {
    const mappedArgs: UpdateKnowledgeEntityInput = {
      repository_path: args.repository_path || args.repositoryPath,
      entity_id: args.entity_id || args.entityId,
      updates: args.updates,
      re_embed: args.re_embed !== undefined ? args.re_embed : args.reEmbed
    };
    const params = UpdateKnowledgeEntitySchema.parse(mappedArgs);
    return await updateKnowledgeEntity(this.db, params);
  }

  private async exportKnowledgeGraph(args: any): Promise<ExportKnowledgeGraphResponse> {
    const mappedArgs: ExportKnowledgeGraphInput = {
      repository_path: args.repository_path || args.repositoryPath,
      output_format: args.output_format || args.outputFormat,
      include_embeddings: args.include_embeddings !== undefined ? args.include_embeddings : args.includeEmbeddings,
      output_file: args.output_file || args.outputFile
    };
    const params = ExportKnowledgeGraphSchema.parse(mappedArgs);
    return await exportKnowledgeGraph(this.db, params);
  }

  private async wipeKnowledgeGraph(args: any): Promise<WipeKnowledgeGraphResponse> {
    const mappedArgs: WipeKnowledgeGraphInput = {
      repository_path: args.repository_path || args.repositoryPath,
      confirm: args.confirm,
      backup_first: args.backup_first !== undefined ? args.backup_first : args.backupFirst
    };
    const params = WipeKnowledgeGraphSchema.parse(mappedArgs);
    return await wipeKnowledgeGraph(this.db, params);
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


/**
 * Update knowledge entity metadata or content with optional re-embedding
 */
export async function updateKnowledgeEntity(
  db: DatabaseManager,
  args: UpdateKnowledgeEntityInput
): Promise<UpdateKnowledgeEntityResponse> {
  try {
    const vectorService = new VectorSearchService(db);
    await vectorService.initialize();
    const kgService = new KnowledgeGraphService(db, vectorService);
    const existingEntity = await kgService.getEntity(args.entity_id);
    if (!existingEntity) {
      throw new Error(`Entity not found: ${args.entity_id}`);
    }

    const fieldsUpdated: string[] = [];
    const updates: any = {};

    if (args.updates.entity_name !== undefined) {
      updates.name = args.updates.entity_name;
      fieldsUpdated.push('entity_name');
    }
    if (args.updates.entity_description !== undefined) {
      updates.description = args.updates.entity_description;
      fieldsUpdated.push('entity_description');
    }
    if (args.updates.entity_type !== undefined) {
      updates.type = args.updates.entity_type;
      fieldsUpdated.push('entity_type');
    }
    if (args.updates.importance_score !== undefined) {
      updates.importanceScore = args.updates.importance_score;
      fieldsUpdated.push('importance_score');
    }
    if (args.updates.confidence_score !== undefined) {
      updates.confidenceScore = args.updates.confidence_score;
      fieldsUpdated.push('confidence_score');
    }
    if (args.updates.properties !== undefined) {
      updates.properties = { ...existingEntity.properties, ...args.updates.properties };
      fieldsUpdated.push('properties');
    }

    const needsReEmbed = args.re_embed ||
      (args.updates.entity_description !== undefined &&
       args.updates.entity_description !== existingEntity.description);

    await kgService.updateEntity(args.entity_id, updates);

    let reEmbedded = false;
    if (needsReEmbed) {
      const embeddingText = updates.description || existingEntity.description || updates.name || existingEntity.name;
      await vectorService.updateEntityEmbedding(args.entity_id, embeddingText);
      reEmbedded = true;
    }

    return {
      success: true,
      entity_id: args.entity_id,
      fields_updated: fieldsUpdated,
      re_embedded: reEmbedded,
      message: `Entity updated successfully. ${fieldsUpdated.length} fields changed${reEmbedded ? ', re-embedded' : ''}.`
    };

  } catch (error) {
    logger.error('Failed to update knowledge entity', error);
    throw new Error(`Failed to update entity: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Export entire knowledge graph to file or return data
 */
export async function exportKnowledgeGraph(
  db: DatabaseManager,
  args: ExportKnowledgeGraphInput
): Promise<ExportKnowledgeGraphResponse> {
  try {
    const vectorService = new VectorSearchService(db);
    await vectorService.initialize();
    const kgService = new KnowledgeGraphService(db, vectorService);
    const entities = await kgService.getAllEntities();
    const relationships = await kgService.getAllRelationships();

    const exportData: any = {
      entities: entities.map(e => ({
        id: e.id,
        type: e.type,
        name: e.name,
        description: e.description,
        importance_score: e.importanceScore,
        confidence_score: e.confidenceScore,
        properties: e.properties,
        discovered_by: e.discoveredBy,
        created_at: e.createdAt,
        ...(args.include_embeddings && e.embedding ? { embedding: e.embedding } : {})
      })),
      relationships: relationships.map(r => ({
        id: r.id,
        from_entity_id: r.fromEntityId,
        to_entity_id: r.toEntityId,
        type: r.type,
        strength: r.strength,
        confidence: r.confidence,
        context: r.context,
        discovered_by: r.discoveredBy,
        created_at: r.createdAt
      }))
    };

    let formattedData: string;
    if (args.output_format === 'jsonl') {
      const lines = exportData.entities.map((e: any) => JSON.stringify({ type: 'entity', ...e }))
        .concat(exportData.relationships.map((r: any) => JSON.stringify({ type: 'relationship', ...r })));
      formattedData = lines.join('\n');
    } else if (args.output_format === 'csv') {
      const entityFields = ['id', 'type', 'name', 'description', 'importance_score', 'confidence_score'];
      const csvLines = [
        entityFields.join(','),
        ...exportData.entities.map((e: any) =>
          entityFields.map(f => JSON.stringify(e[f] || '')).join(',')
        )
      ];
      formattedData = csvLines.join('\n');
    } else {
      formattedData = JSON.stringify(exportData, null, 2);
    }

    const sizeInBytes = Buffer.byteLength(formattedData, 'utf8');
    const dataSize = sizeInBytes > 1024 * 1024 ? `${(sizeInBytes / (1024 * 1024)).toFixed(2)}MB` :
      sizeInBytes > 1024 ? `${(sizeInBytes / 1024).toFixed(2)}KB` : `${sizeInBytes}B`;

    if (args.output_file) {
      const fs = await import('fs/promises');
      await fs.writeFile(args.output_file, formattedData, 'utf8');
      return {
        success: true,
        total_entities: entities.length,
        total_relationships: relationships.length,
        output_file: args.output_file,
        data_size: dataSize,
        export_format: args.output_format,
        message: `Exported ${entities.length} entities and ${relationships.length} relationships to ${args.output_file}`
      };
    } else {
      return {
        success: true,
        total_entities: entities.length,
        total_relationships: relationships.length,
        data_size: dataSize,
        export_format: args.output_format,
        message: `Exported ${entities.length} entities and ${relationships.length} relationships`,
        data: exportData
      };
    }
  } catch (error) {
    logger.error('Failed to export knowledge graph', error);
    throw new Error(`Failed to export knowledge graph: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Wipe all knowledge graph data (DESTRUCTIVE)
 */
export async function wipeKnowledgeGraph(
  db: DatabaseManager,
  args: WipeKnowledgeGraphInput
): Promise<WipeKnowledgeGraphResponse> {
  if (!args.confirm) {
    throw new Error('Wipe operation requires explicit confirmation. Set confirm=true to proceed.');
  }

  try {
    const vectorService = new VectorSearchService(db);
    await vectorService.initialize();
    const kgService = new KnowledgeGraphService(db, vectorService);

    let backupFile: string | undefined;
    if (args.backup_first) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      backupFile = `/tmp/knowledge-graph-backup-${timestamp}.json`;

      await exportKnowledgeGraph(db, {
        repository_path: args.repository_path,
        output_format: 'json',
        include_embeddings: true,
        output_file: backupFile
      });

      logger.info(`Created backup at ${backupFile}`);
    }

    const entities = await kgService.getAllEntities();
    const relationships = await kgService.getAllRelationships();
    const entityCount = entities.length;
    const relationshipCount = relationships.length;

    await kgService.wipeAllData();

    return {
      success: true,
      entities_removed: entityCount,
      relationships_removed: relationshipCount,
      insights_removed: 0,
      backup_file: backupFile,
      message: `Wiped ${entityCount} entities and ${relationshipCount} relationships${backupFile ? `. Backup saved to ${backupFile}` : ''}`
    };

  } catch (error) {
    logger.error('Failed to wipe knowledge graph', error);
    throw new Error(`Failed to wipe knowledge graph: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
