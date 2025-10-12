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
  description: 'GPU semantic search with auto-fallback. See TOOL_LIST.md',
  inputSchema: zodToJsonSchema(SearchKnowledgeGraphGPUSchema) as any,

  async handler({ repository_path, query, limit, threshold, entity_types, include_relationships }) {
    try {
      const embeddingClient = new EmbeddingClient();
      const knowledgeGraph = new KnowledgeGraphService(repository_path);

      // Check GPU availability and log status
      const gpuAvailable = await embeddingClient.checkGPUService();
      const config = embeddingClient.getConfig();
      const modelInfo = embeddingClient.getModelInfo(config.default_model);

      if (gpuAvailable) {
        logger.info(`🚀 Using GPU embedding: ${modelInfo.name} (${modelInfo.dimensions}D)`);
      } else {
        logger.warn('⚠️ GPU service unavailable, semantic search will be disabled');
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
  description: 'GPU service diagnostics and LanceDB status. See TOOL_LIST.md',
  inputSchema: zodToJsonSchema(GetEmbeddingStatusSchema) as any,

  async handler({ repository_path }) {
    try {
      const embeddingClient = new EmbeddingClient();

      // Get comprehensive health status
      const healthStatus = await embeddingClient.getHealthStatus();
      const config = embeddingClient.getConfig();
      const modelInfo = embeddingClient.getModelInfo(config.default_model);

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
  description: 'Switch embedding models (qwen3/gemma3/minilm) for A/B testing. See TOOL_LIST.md',
  inputSchema: zodToJsonSchema(SwitchEmbeddingModeSchema) as any,

  async handler({ repository_path, model }) {
    try {
      const embeddingClient = new EmbeddingClient();

      // Validate model choice against GPU availability
      const config = embeddingClient.getConfig();
      const currentModel = embeddingClient.getModelInfo(config.default_model);
      const gpuAvailable = await embeddingClient.checkGPUService();

      // Get target model specs
      let targetSpecs;
      try {
        targetSpecs = embeddingClient.getModelInfo(model);
      } catch (error) {
        return {
          success: false,
          error: `Unknown model: ${model}. Available: qwen3, gemma3`
        };
      }

      if (targetSpecs.requires_gpu && !gpuAvailable) {
        return {
          success: false,
          error: `Model ${model} requires GPU but GPU service is unavailable`,
          suggestion: "Use 'minilm' for CPU-only mode or check GPU service status"
        };
      }

      // Update default model preference
      embeddingClient.setDefaultModel(model);

      return {
        success: true,
        message: `Successfully updated default model preference from ${currentModel.name} to ${targetSpecs.name}`,
        changes: {
          from: {
            model: config.default_model,
            dimensions: currentModel.dimensions,
            name: currentModel.name
          },
          to: {
            model,
            dimensions: targetSpecs.dimensions,
            name: targetSpecs.name
          }
        },
        note: "Both models remain available simultaneously. This only changes which model is used by default when not specified explicitly."
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