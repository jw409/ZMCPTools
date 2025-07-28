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
  StoreKnowledgeMemoryResponseSchema,
  CreateKnowledgeRelationshipResponseSchema,
  SearchKnowledgeGraphResponseSchema,
  FindRelatedEntitiesResponseSchema,
  type StoreKnowledgeMemoryInput,
  type CreateRelationshipInput,
  type SearchKnowledgeGraphInput,
  type FindRelatedEntitiesInput,
  type StoreKnowledgeMemoryResponse,
  type CreateKnowledgeRelationshipResponse,
  type SearchKnowledgeGraphResponse,
  type FindRelatedEntitiesResponse
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
}

// Re-export schemas for MCP server registration
export { StoreKnowledgeMemorySchema, CreateRelationshipSchema, SearchKnowledgeGraphSchema, FindRelatedEntitiesSchema };

// Re-export types for backward compatibility
export type StoreKnowledgeMemoryArgs = StoreKnowledgeMemoryInput;
export type CreateRelationshipArgs = CreateRelationshipInput;
export type SearchKnowledgeGraphArgs = SearchKnowledgeGraphInput;
export type FindRelatedEntitiesArgs = FindRelatedEntitiesInput;

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
        args.limit
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