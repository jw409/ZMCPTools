/**
 * GPU-Accelerated Search Tools for Multi-Agent Knowledge Sharing
 *
 * Exposes VectorSearchService via MCP for agent access to GPU embeddings
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
import { DiagnosticsLogger } from '../utils/DiagnosticsLogger.js';

// Schemas
const SearchKnowledgeSchema = z.object({
  query: z.string().describe('Search query (natural language or code identifiers)'),
  collection: z.string().optional().describe('Collection to search (default: all). Options: code_symbols, documentation, github_issues, learnings, agent_observations'),
  limit: z.number().optional().default(10).describe('Maximum results to return'),
  threshold: z.number().optional().default(0.3).describe('Minimum similarity score (0-1)')
});

const IndexDocumentSchema = z.object({
  content: z.string().describe('Document content to index'),
  collection: z.string().describe('Target collection. Options: documentation, github_issues, learnings, agent_observations'),
  metadata: z.record(z.any()).optional().describe('Document metadata (tags, source, etc)')
});

const ListCollectionsSchema = z.object({});

const GetCollectionStatsSchema = z.object({
  collection: z.string().describe('Collection name')
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
 * GPU Search Tools
 */
export function getGPUSearchTools(db: DatabaseManager): McpTool[] {
  return [
    {
      name: 'search_knowledge',
      description: 'Search knowledge base using GPU-accelerated embeddings. Searches across code, docs, issues, learnings. Use for: finding relevant context, discovering similar patterns, semantic code search.',
      inputSchema: zodToJsonSchema(SearchKnowledgeSchema),
      handler: async (args) => {
        const { query, collection, limit, threshold } = SearchKnowledgeSchema.parse(args);

        // Start diagnostics logging
        const diagnostics = new DiagnosticsLogger();
        const logId = diagnostics.startRequest('search_knowledge', { query, collection, limit, threshold });

        const service = await getVectorService(db);

        try {
          // Step 1: Initialize service
          diagnostics.addStep('initialize_service', 'success');

          // Step 2: Execute search
          const searchStart = Date.now();
          const results = await service.search(
            query,
            collection, // undefined = search all collections
            limit,
            threshold
          );
          const searchLatency = Date.now() - searchStart;

          diagnostics.addStep('gpu_search', 'success', {
            result_count: results.length,
            latency_ms: searchLatency,
            collection: collection || 'all'
          });

          // End diagnostics with info level (successful search)
          const diagResponse = diagnostics.endRequest(
            searchLatency > 5000 ? 'warn' : 'info',
            searchLatency > 5000
              ? `Search completed but was slow (${searchLatency}ms). Consider using more specific collection.`
              : `Search completed successfully in ${searchLatency}ms`,
            { results: results.length, query, collection }
          );

          return {
            success: true,
            results: results.map(r => ({
              content: r.content.substring(0, 500), // Truncate for display
              similarity: r.similarity,
              metadata: r.metadata,
              collection: r.metadata?.collection
            })),
            total: results.length,
            query,
            collection: collection || 'all',
            diagnostics: diagResponse
          };
        } catch (error) {
          diagnostics.addStep('gpu_search', 'error', {
            error: error instanceof Error ? error.message : 'Unknown error'
          });

          const diagResponse = diagnostics.endRequest(
            'error',
            `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            { query, collection, error }
          );

          return {
            success: false,
            error: error instanceof Error ? error.message : 'Search failed',
            query,
            collection,
            diagnostics: diagResponse
          };
        }
      }
    },

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
    },

    {
      name: 'list_collections',
      description: 'List all available knowledge collections. Use for: discovering what knowledge is available, checking collection status.',
      inputSchema: zodToJsonSchema(ListCollectionsSchema),
      handler: async (args) => {
        const service = await getVectorService(db);

        try {
          const collections = await service.listCollections();

          return {
            success: true,
            collections: collections.map(c => ({
              name: c.name,
              count: c.count,
              metadata: c.metadata
            })),
            total: collections.length
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to list collections'
          };
        }
      }
    },

    {
      name: 'get_collection_stats',
      description: 'Get statistics for a specific collection. Use for: monitoring collection size, checking index health.',
      inputSchema: zodToJsonSchema(GetCollectionStatsSchema),
      handler: async (args) => {
        const { collection } = GetCollectionStatsSchema.parse(args);

        const service = await getVectorService(db);

        try {
          const stats = await service.getCollectionStats(collection);

          return {
            success: true,
            collection: stats.name,
            documentCount: stats.count,
            metadata: stats.metadata
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to get stats',
            collection
          };
        }
      }
    }
  ];
}
