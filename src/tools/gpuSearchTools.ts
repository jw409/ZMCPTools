/**
 * GPU-Accelerated Vector Indexing Tools
 *
 * WRITE-ONLY tools for mutating vector store (read operations use MCP resources)
 *
 * Architecture:
 * - ✅ index_document: WRITE operation (valid tool)
 * - ❌ search_knowledge: Removed (use vector://search resource)
 * - ❌ list_collections: Removed (use vector://collections resource)
 * - ❌ get_collection_stats: Removed (use vector://status resource)
 *
 * See SEARCH_DUPLICATION_AUDIT.md for consolidation rationale.
 *
 * Collections:
 * - code_symbols: Symbol-BM25 (80% recall proven)
 * - documentation: Semantic search (conceptual queries)
 * - github_issues: Semantic + label filtering
 * - learnings: var/harvest/ insights
 * - agent_observations: Agent discoveries
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { McpTool } from '../schemas/tools/index.js';
import { VectorSearchService } from '../services/VectorSearchService.js';
import type { DatabaseManager } from '../database/index.js';

// Schemas
const IndexDocumentSchema = z.object({
  content: z.string().describe('Document content to index'),
  collection: z.string().describe('Target collection. Options: documentation, github_issues, learnings, agent_observations'),
  metadata: z.record(z.any()).optional().describe('Document metadata (tags, source, etc)')
});

// Singleton service instance
let vectorSearchService: VectorSearchService | null = null;

async function getVectorService(db: DatabaseManager): Promise<VectorSearchService> {
  if (!vectorSearchService) {
    vectorSearchService = new VectorSearchService(db, {
      embeddingModel: 'gemma_embed' // 768D GPU embeddings
    });
    await vectorSearchService.initialize();
  }
  return vectorSearchService;
}

/**
 * GPU Vector Indexing Tools (WRITE operations only)
 *
 * Read operations migrated to MCP resources:
 * - vector://search (replaces search_knowledge)
 * - vector://collections (replaces list_collections)
 * - vector://status (replaces get_collection_stats)
 */
export function getGPUSearchTools(db: DatabaseManager): McpTool[] {
  return [
    {
      name: 'index_document',
      description: 'Index a document into GPU vector store for semantic search. Use for: storing agent observations, indexing new docs, adding context to knowledge base.',
      inputSchema: zodToJsonSchema(IndexDocumentSchema),
      handler: async (args) => {
        const { content, collection, metadata } = IndexDocumentSchema.parse(args);

        const service = await getVectorService(db);

        try {
          const result = await service.addDocuments(collection, [{
            id: `${collection}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            content,
            metadata: {
              ...metadata,
              indexed_at: new Date().toISOString(),
              collection
            }
          }]);

          return {
            success: result.success,
            addedCount: result.addedCount,
            collection,
            error: result.error
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Indexing failed',
            collection
          };
        }
      }
    }
  ];
}
