import { z } from 'zod';
import { entityTypeSchema, relationshipTypeSchema } from '../knowledge-graph.js';

// ===============================================
// Knowledge Graph Tool Request Schemas
// ===============================================

export const StoreKnowledgeMemorySchema = z.object({
  repository_path: z.string().min(1).describe("The absolute path to the repository where the knowledge entity should be stored"),
  agent_id: z.string().min(1).describe("The ID of the agent storing this knowledge entity"),
  entity_type: entityTypeSchema.describe("The type of entity being stored (e.g., 'function', 'class', 'concept', 'file', 'bug', 'feature', 'person', 'organization', 'technology', 'pattern', 'insight', 'question', 'decision', 'requirement', 'test', 'documentation', 'api', 'database', 'configuration', 'deployment', 'performance', 'security', 'error', 'warning', 'todo', 'note', 'example', 'tutorial', 'best_practice', 'anti_pattern', 'code_smell', 'refactor', 'optimization', 'dependency', 'service', 'component', 'module', 'library', 'framework', 'tool', 'script', 'command', 'variable', 'constant', 'enum', 'interface', 'type', 'schema', 'model', 'view', 'controller', 'route', 'middleware', 'plugin', 'extension', 'theme', 'style', 'asset', 'resource', 'data', 'event', 'listener', 'handler', 'callback', 'promise', 'async', 'sync', 'thread', 'process', 'memory', 'storage', 'cache', 'session', 'cookie', 'token', 'auth', 'permission', 'role', 'user', 'group', 'setting', 'config', 'env', 'flag', 'feature_flag', 'experiment', 'metric', 'log', 'trace', 'debug', 'info', 'warn', 'error', 'fatal', 'success', 'failure', 'retry', 'timeout', 'rate_limit', 'quota', 'limit', 'threshold', 'rule', 'policy', 'standard', 'guideline', 'convention', 'protocol', 'format', 'encoding', 'compression', 'encryption', 'hash', 'checksum', 'signature', 'certificate', 'key', 'secret', 'password', 'credential', 'identity', 'profile', 'account', 'subscription', 'plan', 'tier', 'level', 'rank', 'score', 'rating', 'review', 'feedback', 'comment', 'message', 'notification', 'alert', 'reminder', 'task', 'job', 'queue', 'batch', 'stream', 'pipeline', 'workflow', 'process', 'procedure', 'method', 'algorithm', 'structure', 'pattern', 'template', 'prototype', 'mock', 'stub', 'fake', 'spy', 'double', 'fixture', 'seed', 'migration', 'rollback', 'upgrade', 'downgrade', 'patch', 'hotfix', 'release', 'version', 'branch', 'tag', 'commit', 'merge', 'rebase', 'cherry_pick', 'stash', 'diff', 'conflict', 'resolution', 'other')"),
  entity_name: z.string().min(1).describe("The name or identifier of the knowledge entity"),
  entity_description: z.string().optional().describe("A detailed description of the knowledge entity and its purpose"),
  importance_score: z.number().min(0).max(1).default(0.5).describe("The importance score of this entity (0.0 to 1.0, where 1.0 is most important)"),
  confidence_score: z.number().min(0).max(1).default(0.7).describe("The confidence score for this entity's accuracy (0.0 to 1.0, where 1.0 is most confident)"),
  properties: z.record(z.string(), z.string()).optional().describe("Additional properties and metadata for the entity as key-value pairs")
}).describe("Store a knowledge entity in the knowledge graph for a specific repository. Use this to capture important information, insights, concepts, or any other knowledge that should be preserved and linked to other entities. The entity will be stored with vector embeddings for semantic search.");

export const CreateRelationshipSchema = z.object({
  repository_path: z.string().min(1).describe("The absolute path to the repository where the relationship should be created"),
  from_entity_id: z.string().min(1).describe("The ID of the source entity in the relationship"),
  to_entity_id: z.string().min(1).describe("The ID of the target entity in the relationship"),
  relationship_type: relationshipTypeSchema.describe("The type of relationship between the entities (e.g., 'depends_on', 'implements', 'extends', 'uses', 'calls', 'contains', 'part_of', 'similar_to', 'related_to', 'conflicts_with', 'replaces', 'references', 'documents', 'tests', 'configures', 'deploys', 'monitors', 'validates', 'triggers', 'handles', 'processes', 'stores', 'retrieves', 'transforms', 'aggregates', 'filters', 'sorts', 'groups', 'joins', 'merges', 'splits', 'compresses', 'encrypts', 'decrypts', 'hashes', 'signs', 'verifies', 'authenticates', 'authorizes', 'logs', 'traces', 'debugs', 'profiles', 'benchmarks', 'optimizes', 'refactors', 'migrates', 'upgrades', 'downgrades', 'patches', 'releases', 'versions', 'branches', 'tags', 'commits', 'merges', 'rebases', 'cherry_picks', 'stashes', 'diffs', 'conflicts', 'resolves', 'other')"),
  strength: z.number().min(0).max(1).default(0.7).describe("The strength of the relationship (0.0 to 1.0, where 1.0 is strongest)"),
  confidence: z.number().min(0).max(1).default(0.7).describe("The confidence in the relationship's accuracy (0.0 to 1.0, where 1.0 is most confident)"),
  context: z.string().optional().describe("Additional context or description about the relationship"),
  discovered_by: z.string().optional().describe("The agent or process that discovered this relationship"),
  properties: z.record(z.string(), z.unknown()).optional().describe("Additional properties and metadata for the relationship as key-value pairs")
}).describe("Create a directional relationship between two existing entities in the knowledge graph. Use this to establish connections and dependencies between entities, enabling graph traversal and relationship analysis.");

export const SearchKnowledgeGraphSchema = z.object({
  repository_path: z.string().min(1).describe("The absolute path to the repository to search within"),
  query: z.string().min(1).describe("The search query text. Can be natural language for semantic search or specific terms for exact matching"),
  entity_types: z.array(entityTypeSchema).optional().describe("Optional array of entity types to filter the search results. If not provided, all entity types will be searched"),
  relationship_types: z.array(relationshipTypeSchema).optional().describe("Optional array of relationship types to filter relationships in the results. If not provided, all relationship types will be included"),
  use_semantic_search: z.boolean().default(true).describe("Whether to use semantic vector search (true) or basic text matching (false). Semantic search is more powerful for finding conceptually related entities"),
  include_relationships: z.boolean().default(true).describe("Whether to include relationships between entities in the search results. Set to false for faster queries when only entities are needed"),
  limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of results to return (1-100)"),
  threshold: z.number().min(0).max(1).default(0.7).describe("Similarity threshold for semantic search results (0.0 to 1.0, where 1.0 requires exact matches)")
}).describe("Search the knowledge graph using semantic or text-based queries. This tool can find entities and relationships based on natural language queries, making it easy to discover relevant knowledge. Use semantic search for conceptual queries and basic search for exact term matching.");

export const FindRelatedEntitiesSchema = z.object({
  repository_path: z.string().min(1).describe("The absolute path to the repository to search within"),
  entity_id: z.string().min(1).describe("The ID of the entity to find related entities for"),
  relationship_types: z.array(relationshipTypeSchema).optional().describe("Optional array of relationship types to filter the traversal. If not provided, all relationship types will be considered"),
  max_distance: z.number().int().min(1).max(5).default(2).describe("Maximum distance (number of hops) to traverse in the graph when finding related entities (1-5)"),
  min_strength: z.number().min(0).max(1).default(0.5).describe("Minimum relationship strength required to include a relationship in the traversal (0.0 to 1.0)")
}).describe("Find entities that are related to a given entity through relationship traversal. This tool performs graph traversal to discover connected entities within a specified distance, allowing you to explore the knowledge graph around a specific entity. Use this to understand dependencies, find similar concepts, or discover related components.");

// Memory Management Schemas
export const PruneMemorySchema = z.object({
  repository_path: z.string().min(1).describe("The absolute path to the repository to prune"),
  pollution_patterns: z.array(z.string()).optional().describe("Specific content patterns to identify as pollution (e.g., 'seven separate task systems', 'context loss')"),
  superseded_by: z.array(z.string()).optional().describe("Entity IDs that supersede/replace the polluted knowledge"),
  min_importance_threshold: z.number().min(0).max(1).default(0.3).describe("Remove entities below this importance threshold (0.0 to 1.0)"),
  confidence_threshold: z.number().min(0).max(1).default(0.5).describe("Remove entities below this confidence threshold (0.0 to 1.0)"),
  dry_run: z.boolean().default(true).describe("Preview what would be pruned without actually removing anything")
}).describe("Prune polluted or outdated knowledge from the memory graph based on content patterns and quality thresholds rather than arbitrary dates.");

export const CompactMemorySchema = z.object({
  repository_path: z.string().min(1).describe("The absolute path to the repository to compact"),
  remove_duplicates: z.boolean().default(true).describe("Remove duplicate entities with identical or very similar content"),
  merge_similar: z.boolean().default(false).describe("Merge highly similar entities (>0.9 similarity) into single canonical entities"),
  similarity_threshold: z.number().min(0.7).max(1).default(0.95).describe("Similarity threshold for considering entities as duplicates (0.7 to 1.0)"),
  preserve_relationships: z.boolean().default(true).describe("Preserve relationships when merging entities")
}).describe("Compact memory by removing duplicates and merging similar entities to reduce graph pollution.");

export const MemoryStatusSchema = z.object({
  repository_path: z.string().min(1).describe("The absolute path to the repository to analyze")
}).describe("Get comprehensive memory status including pollution indicators, context distribution, and quality metrics.");

export const UpdateKnowledgeEntitySchema = z.object({
  repository_path: z.string().min(1).describe("The absolute path to the repository"),
  entity_id: z.string().min(1).describe("The ID of the entity to update"),
  updates: z.object({
    entity_name: z.string().optional().describe("New name for the entity"),
    entity_description: z.string().optional().describe("New description for the entity"),
    entity_type: entityTypeSchema.optional().describe("New type for the entity"),
    importance_score: z.number().min(0).max(1).optional().describe("New importance score (0.0 to 1.0)"),
    confidence_score: z.number().min(0).max(1).optional().describe("New confidence score (0.0 to 1.0)"),
    properties: z.record(z.string(), z.string()).optional().describe("Properties to merge with existing properties")
  }).describe("Fields to update - only provided fields will be changed"),
  re_embed: z.boolean().optional().describe("Force re-embedding. Auto-enabled if description changes")
}).describe("Update entity metadata or content with optional re-embedding. Updates: importance_score, confidence_score, entity_type, entity_name, entity_description, properties. Re-embedding: Auto if description changes, or force with re_embed=true. Requires GPU if re-embedding.");

export const ExportKnowledgeGraphSchema = z.object({
  repository_path: z.string().min(1).describe("The absolute path to the repository to export knowledge from"),
  output_format: z.enum(['json', 'jsonl', 'csv']).default('json').describe("Output format for the exported data"),
  include_embeddings: z.boolean().default(false).describe("Whether to include vector embeddings in the export (creates larger files)"),
  output_file: z.string().optional().describe("Optional file path to save the export. If not provided, returns the data directly")
}).describe("Export the entire knowledge graph to a file or return the data. Use this before wiping to backup existing knowledge.");

export const WipeKnowledgeGraphSchema = z.object({
  repository_path: z.string().min(1).describe("The absolute path to the repository to wipe knowledge from"),
  confirm: z.boolean().default(false).describe("Safety confirmation flag. Must be set to true to actually wipe all knowledge graph data"),
  backup_first: z.boolean().default(true).describe("Whether to create a backup before wiping. Strongly recommended for safety")
}).describe("Completely wipe all knowledge graph data for a repository. This is a destructive operation that removes all entities, relationships, and insights. Requires explicit confirmation.");

// Export input types
export type StoreKnowledgeMemoryInput = z.infer<typeof StoreKnowledgeMemorySchema>;
export type CreateRelationshipInput = z.infer<typeof CreateRelationshipSchema>;
export type SearchKnowledgeGraphInput = z.infer<typeof SearchKnowledgeGraphSchema>;
export type FindRelatedEntitiesInput = z.infer<typeof FindRelatedEntitiesSchema>;
export type PruneMemoryInput = z.infer<typeof PruneMemorySchema>;
export type CompactMemoryInput = z.infer<typeof CompactMemorySchema>;
export type MemoryStatusInput = z.infer<typeof MemoryStatusSchema>;
export type UpdateKnowledgeEntityInput = z.infer<typeof UpdateKnowledgeEntitySchema>;
export type ExportKnowledgeGraphInput = z.infer<typeof ExportKnowledgeGraphSchema>;
export type WipeKnowledgeGraphInput = z.infer<typeof WipeKnowledgeGraphSchema>;

// ===============================================
// Knowledge Graph Tool Response Schemas
// ===============================================

// Store Knowledge Memory Response
export const StoreKnowledgeMemoryResponseSchema = z.object({
  success: z.boolean().describe("Whether the knowledge entity was successfully stored"),
  entity_id: z.string().describe("The unique ID of the created knowledge entity"),
  message: z.string().describe("A descriptive message about the storage operation")
}).describe("Response from storing a knowledge entity in the knowledge graph");

// Create Knowledge Relationship Response  
export const CreateKnowledgeRelationshipResponseSchema = z.object({
  success: z.boolean().describe("Whether the relationship was successfully created"),
  relationship_id: z.string().describe("The unique ID of the created relationship"),
  message: z.string().describe("A descriptive message about the relationship creation")
}).describe("Response from creating a relationship between two knowledge entities");

// Search Knowledge Graph Response
export const SearchKnowledgeGraphResponseSchema = z.object({
  entities: z.array(z.object({
    id: z.string().describe("The unique ID of the entity"),
    type: z.string().describe("The type of the entity"),
    name: z.string().describe("The name of the entity"),
    description: z.string().optional().describe("The description of the entity"),
    importance_score: z.number().describe("The importance score of the entity (0.0 to 1.0)"),
    confidence_score: z.number().describe("The confidence score of the entity (0.0 to 1.0)"),
    properties: z.record(z.string(), z.unknown()).optional().describe("Additional properties of the entity"),
    discovered_by: z.string().optional().describe("The agent or process that discovered this entity"),
    created_at: z.string().describe("The timestamp when the entity was created")
  })).describe("Array of entities found in the search"),
  relationships: z.array(z.object({
    id: z.string().describe("The unique ID of the relationship"),
    from_entity_id: z.string().describe("The ID of the source entity"),
    to_entity_id: z.string().describe("The ID of the target entity"),
    type: z.string().describe("The type of the relationship"),
    strength: z.number().describe("The strength of the relationship (0.0 to 1.0)"),
    confidence: z.number().describe("The confidence in the relationship (0.0 to 1.0)"),
    context: z.string().optional().describe("Additional context about the relationship"),
    discovered_by: z.string().optional().describe("The agent or process that discovered this relationship"),
    created_at: z.string().describe("The timestamp when the relationship was created")
  })).describe("Array of relationships found in the search"),
  total_results: z.number().describe("The total number of results found (entities + relationships)"),
  search_metadata: z.object({
    search_type: z.string().describe("The type of search performed (semantic or basic)"),
    processing_time: z.number().describe("The time taken to process the search in milliseconds")
  }).describe("Metadata about the search operation")
}).describe("Response from searching the knowledge graph, containing entities and relationships that match the query");

// Find Related Entities Response
export const FindRelatedEntitiesResponseSchema = z.object({
  entities: z.array(z.object({
    id: z.string().describe("The unique ID of the related entity"),
    type: z.string().describe("The type of the related entity"),
    name: z.string().describe("The name of the related entity"),
    description: z.string().optional().describe("The description of the related entity"),
    importance_score: z.number().describe("The importance score of the related entity (0.0 to 1.0)"),
    confidence_score: z.number().describe("The confidence score of the related entity (0.0 to 1.0)"),
    relationships: z.array(z.object({
      id: z.string().describe("The unique ID of the relationship"),
      type: z.string().describe("The type of the relationship"),
      strength: z.number().describe("The strength of the relationship (0.0 to 1.0)"),
      confidence: z.number().describe("The confidence in the relationship (0.0 to 1.0)")
    })).describe("Array of relationships connected to this entity")
  })).describe("Array of entities found to be related to the target entity"),
  relationships: z.array(z.object({
    id: z.string().describe("The unique ID of the relationship"),
    from_entity_id: z.string().describe("The ID of the source entity"),
    to_entity_id: z.string().describe("The ID of the target entity"),
    type: z.string().describe("The type of the relationship"),
    strength: z.number().describe("The strength of the relationship (0.0 to 1.0)"),
    confidence: z.number().describe("The confidence in the relationship (0.0 to 1.0)")
  })).describe("Array of all relationships in the traversal path"),
  total_found: z.number().describe("The total number of related entities found")
}).describe("Response from finding related entities through graph traversal, containing entities connected to the target entity and their relationships");

// Memory Management Response Schemas
export const PruneMemoryResponseSchema = z.object({
  success: z.boolean().describe("Whether the pruning operation was successful"),
  dry_run: z.boolean().describe("Whether this was a preview run"),
  entities_found: z.number().describe("Number of entities identified for pruning"),
  entities_removed: z.number().describe("Number of entities actually removed (0 for dry runs)"),
  pollution_patterns_matched: z.array(z.string()).describe("Patterns that matched polluted content"),
  backup_created: z.string().optional().describe("Path to backup file if created"),
  message: z.string().describe("Summary of the pruning operation")
}).describe("Response from pruning polluted memory content");

export const CompactMemoryResponseSchema = z.object({
  success: z.boolean().describe("Whether the compaction was successful"),
  duplicates_removed: z.number().describe("Number of duplicate entities removed"),
  entities_merged: z.number().describe("Number of similar entities merged"),
  relationships_consolidated: z.number().describe("Number of relationships consolidated during merging"),
  space_saved_percent: z.number().describe("Estimated percentage of space saved"),
  message: z.string().describe("Summary of the compaction operation")
}).describe("Response from memory compaction operation");

export const MemoryStatusResponseSchema = z.object({
  total_entities: z.number().describe("Total number of entities in the knowledge graph"),
  total_relationships: z.number().describe("Total number of relationships"),
  context_distribution: z.record(z.string(), z.number()).describe("Distribution of entities by context (dom0, talent, project, session)"),
  quality_metrics: z.object({
    avg_importance: z.number().describe("Average importance score across all entities"),
    avg_confidence: z.number().describe("Average confidence score across all entities"),
    low_quality_entities: z.number().describe("Number of entities below quality thresholds")
  }).describe("Overall quality metrics for the knowledge graph"),
  pollution_indicators: z.array(z.object({
    pattern: z.string().describe("Pollution pattern detected"),
    entity_count: z.number().describe("Number of entities matching this pattern"),
    example_entities: z.array(z.string()).describe("Example entity names matching this pattern")
  })).describe("Detected pollution patterns in the knowledge graph"),
  recommendations: z.array(z.string()).describe("Recommended cleanup actions based on analysis")
}).describe("Comprehensive status of memory health and pollution indicators");

export const UpdateKnowledgeEntityResponseSchema = z.object({
  success: z.boolean().describe("Whether the update was successful"),
  entity_id: z.string().describe("The ID of the updated entity"),
  fields_updated: z.array(z.string()).describe("List of fields that were updated"),
  re_embedded: z.boolean().describe("Whether the entity was re-embedded"),
  message: z.string().describe("Summary of the update operation")
}).describe("Response from updating a knowledge entity");

export const ExportKnowledgeGraphResponseSchema = z.object({
  success: z.boolean().describe("Whether the export operation was successful"),
  total_entities: z.number().describe("Number of entities exported"),
  total_relationships: z.number().describe("Number of relationships exported"),
  output_file: z.string().optional().describe("File path where data was saved (if output_file was provided)"),
  data_size: z.string().describe("Size of exported data (e.g., '2.5MB', '1.2KB')"),
  export_format: z.string().describe("Format used for the export"),
  message: z.string().describe("Summary message about the export operation"),
  data: z.unknown().optional().describe("The exported data if no output_file was specified")
}).describe("Response from exporting knowledge graph data");

export const WipeKnowledgeGraphResponseSchema = z.object({
  success: z.boolean().describe("Whether the wipe operation was successful"),
  entities_removed: z.number().describe("Number of entities removed from the knowledge graph"),
  relationships_removed: z.number().describe("Number of relationships removed from the knowledge graph"),
  insights_removed: z.number().describe("Number of insights removed from the knowledge graph"),
  backup_file: z.string().optional().describe("Path to backup file if backup was created"),
  message: z.string().describe("Summary message about the wipe operation")
}).describe("Response from wiping knowledge graph data");

// Export response types
export type StoreKnowledgeMemoryResponse = z.infer<typeof StoreKnowledgeMemoryResponseSchema>;
export type CreateKnowledgeRelationshipResponse = z.infer<typeof CreateKnowledgeRelationshipResponseSchema>;
export type SearchKnowledgeGraphResponse = z.infer<typeof SearchKnowledgeGraphResponseSchema>;
export type FindRelatedEntitiesResponse = z.infer<typeof FindRelatedEntitiesResponseSchema>;
export type PruneMemoryResponse = z.infer<typeof PruneMemoryResponseSchema>;
export type CompactMemoryResponse = z.infer<typeof CompactMemoryResponseSchema>;
export type MemoryStatusResponse = z.infer<typeof MemoryStatusResponseSchema>;
export type UpdateKnowledgeEntityResponse = z.infer<typeof UpdateKnowledgeEntityResponseSchema>;
export type ExportKnowledgeGraphResponse = z.infer<typeof ExportKnowledgeGraphResponseSchema>;
export type WipeKnowledgeGraphResponse = z.infer<typeof WipeKnowledgeGraphResponseSchema>;