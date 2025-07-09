/**
 * Simplified MCP Tools for Knowledge Graph
 * Uses only the core KnowledgeGraphService and VectorSearchService
 */

import { z } from 'zod';
import { DatabaseManager } from '../database/index.js';
import { KnowledgeGraphService } from '../services/KnowledgeGraphService.js';
import { VectorSearchService } from '../services/VectorSearchService.js';
import { Logger } from '../utils/logger.js';
import {
  entityTypeSchema,
  relationshipTypeSchema,
  type NewKnowledgeEntity,
  type NewKnowledgeRelationship,
  type EntityFilter,
  type RelationshipFilter
} from '../schemas/knowledge-graph.js';

const logger = new Logger('knowledge-graph-tools');

// Schema for storing knowledge graph memories
const storeKnowledgeMemorySchema = z.object({
  repository_path: z.string().min(1),
  agent_id: z.string().min(1),
  entity_type: entityTypeSchema,
  entity_name: z.string().min(1),
  entity_description: z.string().optional(),
  importance_score: z.number().min(0).max(1).default(0.5),
  confidence_score: z.number().min(0).max(1).default(0.7),
  properties: z.record(z.string(), z.unknown()).optional()
});

// Schema for creating relationships
const createRelationshipSchema = z.object({
  repository_path: z.string().min(1),
  from_entity_id: z.string().min(1),
  to_entity_id: z.string().min(1),
  relationship_type: relationshipTypeSchema,
  strength: z.number().min(0).max(1).default(0.7),
  confidence: z.number().min(0).max(1).default(0.7),
  context: z.string().optional(),
  discovered_by: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional()
});

// Schema for searching knowledge graph
const searchKnowledgeGraphSchema = z.object({
  repository_path: z.string().min(1),
  query: z.string().min(1),
  entity_types: z.array(entityTypeSchema).optional(),
  relationship_types: z.array(relationshipTypeSchema).optional(),
  use_semantic_search: z.boolean().default(true),
  include_relationships: z.boolean().default(true),
  limit: z.number().int().min(1).max(100).default(20),
  threshold: z.number().min(0).max(1).default(0.7)
});

// Schema for finding related entities
const findRelatedEntitiesSchema = z.object({
  repository_path: z.string().min(1),
  entity_id: z.string().min(1),
  relationship_types: z.array(relationshipTypeSchema).optional(),
  max_distance: z.number().int().min(1).max(5).default(2),
  min_strength: z.number().min(0).max(1).default(0.5)
});

/**
 * Store a knowledge graph memory with entity creation
 */
export async function storeKnowledgeMemory(
  db: DatabaseManager,
  args: z.infer<typeof storeKnowledgeMemorySchema>
): Promise<{
  success: boolean;
  entity_id: string;
  message: string;
}> {
  try {
    logger.info('Storing knowledge graph memory', args);
    
    // Initialize services
    const vectorService = new VectorSearchService(db);
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
  args: z.infer<typeof createRelationshipSchema>
): Promise<{
  success: boolean;
  relationship_id: string;
  message: string;
}> {
  try {
    logger.info('Creating knowledge relationship', args);
    
    const vectorService = new VectorSearchService(db);
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
  args: z.infer<typeof searchKnowledgeGraphSchema>
): Promise<{
  entities: any[];
  relationships: any[];
  total_results: number;
  search_metadata: {
    search_type: string;
    processing_time: number;
  };
}> {
  try {
    logger.info('Searching knowledge graph', args);
    
    const vectorService = new VectorSearchService(db);
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
      // Use basic search by type if available
      if (args.entity_types && args.entity_types.length > 0) {
        entities = await knowledgeGraph.findEntitiesByType(
          args.entity_types[0],
          args.repository_path,
          args.limit
        );
      } else {
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
  args: z.infer<typeof findRelatedEntitiesSchema>
): Promise<{
  entities: any[];
  relationships: any[];
  total_found: number;
}> {
  try {
    logger.info('Finding related entities', args);
    
    const vectorService = new VectorSearchService(db);
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

// Export tool definitions for MCP
export const knowledgeGraphTools = {
  store_knowledge_memory: {
    name: 'store_knowledge_memory',
    description: 'Store a knowledge graph memory with entity creation',
    inputSchema: storeKnowledgeMemorySchema,
    handler: storeKnowledgeMemory
  },
  create_knowledge_relationship: {
    name: 'create_knowledge_relationship',
    description: 'Create a relationship between two entities in the knowledge graph',
    inputSchema: createRelationshipSchema,
    handler: createKnowledgeRelationship
  },
  search_knowledge_graph: {
    name: 'search_knowledge_graph',
    description: 'Search the knowledge graph',
    inputSchema: searchKnowledgeGraphSchema,
    handler: searchKnowledgeGraph
  },
  find_related_entities: {
    name: 'find_related_entities',
    description: 'Find related entities through relationship traversal',
    inputSchema: findRelatedEntitiesSchema,
    handler: findRelatedEntities
  }
};