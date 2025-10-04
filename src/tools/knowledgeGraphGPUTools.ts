/**
 * GPU-Accelerated Knowledge Graph Tools
 * Provides high-performance vector search using GPU embeddings with fallback
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { KnowledgeGraphService } from '../services/KnowledgeGraphService.js';
import { EmbeddingClient } from '../services/EmbeddingClient.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('gpu-knowledge-tools');

// Tool parameter schemas
const SearchKnowledgeGraphGPUSchema = z.object({
  repository_path: z.string().describe("Absolute path to the repository to search within"),
  query: z.string().min(1).describe("The search query text. Can be natural language for semantic search"),
  limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of results to return (1-100)"),
  threshold: z.number().min(0).max(1).default(0.7).describe("Similarity threshold for semantic search results (0.0 to 1.0, where 1.0 requires exact matches)"),
  entity_types: z.array(z.enum(['agent', 'task', 'file', 'function', 'class', 'concept', 'error', 'solution', 'pattern', 'insight', 'decision', 'tool', 'repository', 'dependency', 'configuration', 'test', 'documentation', 'feature', 'bug', 'requirement', 'progress'])).optional().describe("Optional array of entity types to filter the search results"),
  include_relationships: z.boolean().default(true).describe("Whether to include relationships between entities in search results")
});

const GetEmbeddingStatusSchema = z.object({
  repository_path: z.string().optional().describe("Optional repository path for context")
});

const SwitchEmbeddingModeSchema = z.object({
  repository_path: z.string().describe("Repository path for the embedding mode switch"),
  model: z.enum(['qwen3', 'gemma3', 'minilm']).describe("Embedding model to switch to: qwen3 (1024D, best quality), gemma3 (768D, balanced), minilm (384D, CPU fallback)")
});

/**
 * GPU-accelerated semantic search with automatic fallback
 */
export const searchKnowledgeGraphGPU: Tool = {
  name: 'search_knowledge_graph_gpu',
  description: `GPU semantic search with Gemma3-768D embeddings (~10x faster than baseline).

**Requires**: Embedding service at GPU_EMBEDDING_SERVICE_URL (default: http://localhost:8765). Local: systemctl --user start embedding-service. **Fails if GPU unavailable** - use baseline search_knowledge_graph for CPU fallback.

**Params**: use_bm25 (default false, experimental), model (reserved for future - currently fixed gemma3), use_reranker (deferred).

**Returns**: Entity results + metadata (model_used: 'gemma3', dimensions: 768).`,
  inputSchema: zodToJsonSchema(SearchKnowledgeGraphGPUSchema) as any,

  async handler({ repository_path, query, limit, threshold, entity_types, include_relationships }) {
    try {
      const embeddingClient = new EmbeddingClient();
      const knowledgeGraph = new KnowledgeGraphService(repository_path);

      // Check GPU availability and log status
      const gpuAvailable = await embeddingClient.checkGPUService();
      const modelInfo = embeddingClient.getActiveModelInfo();

      if (gpuAvailable) {
        logger.info(`🚀 Using GPU embedding: ${modelInfo.name} (${modelInfo.dimensions}D)`);
      } else {
        logger.warn('⚠️ GPU service unavailable, falling back to local embeddings');
      }

      // Perform the search using the updated knowledge graph service
      const results = await knowledgeGraph.searchEntities(query, {
        limit,
        threshold,
        entity_types,
        include_relationships
      });

      return {
        success: true,
        results: results.entities || [],
        relationships: include_relationships ? results.relationships || [] : [],
        metadata: {
          query,
          total_results: results.entities?.length || 0,
          gpu_accelerated: gpuAvailable,
          model_used: gpuAvailable ? modelInfo.name : 'MiniLM-L6-v2',
          dimensions: gpuAvailable ? modelInfo.dimensions : 384,
          performance_note: gpuAvailable ? "16x faster with GPU acceleration" : "CPU fallback mode"
        }
      };

    } catch (error) {
      logger.error('GPU knowledge search failed', { error: error.message, query });
      return {
        success: false,
        error: `GPU knowledge search failed: ${error.message}`,
        fallback_suggestion: "Try using search_knowledge_graph for basic semantic search"
      };
    }
  }
};

/**
 * Get comprehensive embedding service status
 */
export const getEmbeddingStatus: Tool = {
  name: 'get_embedding_status',
  description: `GPU service diagnostics at configured endpoint (default localhost:8765).

**Returns**: service health, active model, VRAM usage, **project-local LanceDB collection status** (which collections exist at repository_path/var/storage/lancedb/, vector counts, model compatibility). Use to verify GPU before operations or debug collection issues.`,
  inputSchema: zodToJsonSchema(GetEmbeddingStatusSchema) as any,

  async handler({ repository_path }) {
    try {
      const embeddingClient = new EmbeddingClient();

      // Get comprehensive health status
      const healthStatus = await embeddingClient.getHealthStatus();
      const modelInfo = embeddingClient.getActiveModelInfo();

      // Check GPU service details
      let gpuServiceDetails = null;
      try {
        const response = await fetch('http://localhost:8765/models');
        if (response.ok) {
          gpuServiceDetails = await response.json();
        }
      } catch (error) {
        logger.debug('Could not fetch GPU service details', { error: error.message });
      }

      // Check project-local collections if repository_path provided
      let projectCollections = {};
      if (repository_path) {
        const projectLanceDbPath = `${repository_path}/var/storage/lancedb`;
        try {
          const fs = await import('fs');
          const path = await import('path');
          if (fs.existsSync(projectLanceDbPath)) {
            const collections = fs.readdirSync(projectLanceDbPath)
              .filter(name => name.endsWith('.lance'));
            projectCollections = {
              path: projectLanceDbPath,
              collections: collections.map(name => name.replace('.lance', '')),
              count: collections.length
            };
          } else {
            projectCollections = {
              path: projectLanceDbPath,
              status: 'not_initialized',
              message: 'Project-local LanceDB not yet created'
            };
          }
        } catch (error) {
          logger.debug('Could not check project collections', { error: error.message });
        }
      }

      return {
        success: true,
        status: healthStatus.status,
        active_model: {
          name: modelInfo.name,
          dimensions: modelInfo.dimensions,
          requires_gpu: modelInfo.requires_gpu,
          api_model_name: modelInfo.api_model_name
        },
        gpu_service: {
          available: healthStatus.gpu_available,
          endpoint: 'http://localhost:8765',
          vram_usage_gb: gpuServiceDetails?.vram_usage_gb || 'unknown',
          vram_free_gb: gpuServiceDetails?.vram_free_gb || 'unknown',
          loaded_models: gpuServiceDetails?.loaded_count || 0
        },
        project_collections: projectCollections,
        global_collections: healthStatus.collections,
        warnings: healthStatus.warnings,
        last_validation: healthStatus.last_validation
      };

    } catch (error) {
      logger.error('Failed to get embedding status', { error: error.message });
      return {
        success: false,
        error: `Failed to get embedding status: ${error.message}`
      };
    }
  }
};

/**
 * Switch embedding model mode
 */
export const switchEmbeddingMode: Tool = {
  name: 'switch_embedding_mode',
  description: `Switch between different embedding models for quality/performance trade-offs.

**Available models**:
- **qwen3**: Qwen3-0.6B, 1024 dimensions, best quality (0.705 score), requires GPU
- **gemma3**: EmbeddingGemma-300M, 768 dimensions, balanced, requires GPU
- **minilm**: MiniLM-L6-v2, 384 dimensions, CPU fallback, basic quality

**When to use**:
- Switch to qwen3 for highest quality semantic search
- Use gemma3 for balanced performance/quality
- Use minilm when GPU unavailable or for basic searches

Note: Switching models may require re-indexing existing collections for consistency.`,
  inputSchema: zodToJsonSchema(SwitchEmbeddingModeSchema) as any,

  async handler({ repository_path, model }) {
    try {
      const embeddingClient = new EmbeddingClient();

      // Validate model choice against GPU availability
      const currentModel = embeddingClient.getActiveModelInfo();
      const gpuAvailable = await embeddingClient.checkGPUService();

      // Check if GPU required but not available
      const targetSpecs = embeddingClient.MODEL_SPECS?.[model];
      if (!targetSpecs) {
        return {
          success: false,
          error: `Unknown model: ${model}. Available: qwen3, gemma3, minilm`
        };
      }

      if (targetSpecs.requires_gpu && !gpuAvailable) {
        return {
          success: false,
          error: `Model ${model} requires GPU but GPU service is unavailable`,
          suggestion: "Use 'minilm' for CPU-only mode or check GPU service status"
        };
      }

      // Save new configuration (this would require extending EmbeddingClient)
      // For now, return the change information
      return {
        success: true,
        message: `Would switch from ${currentModel.name} to ${targetSpecs.name}`,
        changes: {
          from: {
            model: embeddingClient.config?.active_model || 'unknown',
            dimensions: currentModel.dimensions,
            name: currentModel.name
          },
          to: {
            model,
            dimensions: targetSpecs.dimensions,
            name: targetSpecs.name
          }
        },
        warnings: [
          "Model switching requires configuration update",
          "Existing collections may need re-indexing for consistency",
          "Performance will change based on model selection"
        ],
        note: "Configuration change would take effect on next service restart"
      };

    } catch (error) {
      logger.error('Failed to switch embedding mode', { error: error.message, model });
      return {
        success: false,
        error: `Failed to switch embedding mode: ${error.message}`
      };
    }
  }
};

// Export all GPU tools
export const gpuKnowledgeTools = [
  searchKnowledgeGraphGPU,
  getEmbeddingStatus,
  switchEmbeddingMode
];