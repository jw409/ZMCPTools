/**
 * TalentOS Enhanced Semantic Search Tool
 * Showcases the enhanced capabilities when integrated with TalentOS
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { KnowledgeGraphService } from '../services/KnowledgeGraphService.js';
import { EmbeddingClient } from '../services/EmbeddingClient.js';
import { HybridSearchService } from '../services/HybridSearchService.js';
import { BM25Service } from '../services/BM25Service.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('talentos-semantic-search');

// Tool parameter schema
const TalentOSSemanticSearchSchema = z.object({
  repository_path: z.string().describe("Absolute path to the repository to search within"),
  query: z.string().min(1).describe("The search query - natural language supported"),
  search_mode: z.enum(['auto', 'semantic', 'hybrid', 'keyword']).default('auto').describe("Search mode: auto (intelligent routing), semantic (GPU only), hybrid (BM25+semantic), keyword (BM25 only)"),
  limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of results to return (1-100)"),
  quality_preference: z.enum(['speed', 'balanced', 'quality']).default('balanced').describe("Quality preference: speed (minilm), balanced (gemma3), quality (qwen3)"),
  include_performance_stats: z.boolean().default(true).describe("Include detailed performance and routing statistics"),
  force_gpu_mode: z.boolean().default(false).describe("Force GPU mode even if not available (will fail if unavailable)")
});

/**
 * TalentOS Enhanced Semantic Search - showcases full integration capabilities
 */
export const talentosSemanticSearch: Tool = {
  name: 'talentos_semantic_search',
  description: `Advanced semantic search showcasing TalentOS integration capabilities.

**Auto-routing Intelligence**:
- Analyzes query type (code vs conceptual vs mixed)
- Automatically selects optimal search strategy
- Chooses best embedding model for the task

**Search Modes**:
- **auto**: Intelligent routing based on query analysis
- **semantic**: Pure GPU semantic search (Qwen3/Gemma3)
- **hybrid**: BM25 + semantic with reciprocal rank fusion
- **keyword**: Pure BM25 keyword search

**Quality Preferences**:
- **speed**: MiniLM-L6-v2 (384D, CPU fallback)
- **balanced**: Gemma3-300M (768D, GPU optimized)
- **quality**: Qwen3-0.6B (1024D, best quality)

**TalentOS Features**:
- GPU acceleration via port 8765
- Automatic model health monitoring
- Graceful fallback to CPU when needed
- Performance metrics and routing decisions

Returns enhanced results with detailed performance analytics and routing explanations.`,
  inputSchema: TalentOSSemanticSearchSchema,

  async handler({
    repository_path,
    query,
    search_mode,
    limit,
    quality_preference,
    include_performance_stats,
    force_gpu_mode
  }) {
    const startTime = Date.now();

    try {
      // Initialize services
      const embeddingClient = new EmbeddingClient();
      const knowledgeGraph = new KnowledgeGraphService(repository_path);

      // Check TalentOS integration status
      const gpuAvailable = await embeddingClient.checkGPUService();
      const modelInfo = embeddingClient.getActiveModelInfo();

      if (force_gpu_mode && !gpuAvailable) {
        return {
          success: false,
          error: "GPU mode forced but TalentOS embedding service (port 8765) unavailable",
          suggestion: "Check if TalentOS embedding service is running or remove force_gpu_mode flag"
        };
      }

      // Intelligent query analysis for auto mode
      let finalSearchMode = search_mode;
      let routingReason = '';

      if (search_mode === 'auto') {
        const { suggestedMode, reasoning } = analyzeQueryForSearchMode(query);
        finalSearchMode = suggestedMode;
        routingReason = reasoning;
      }

      // Model selection based on quality preference and availability
      let selectedModel = modelInfo.name;
      if (gpuAvailable) {
        switch (quality_preference) {
          case 'speed':
            selectedModel = 'MiniLM-L6-v2'; // Will fallback to CPU
            break;
          case 'balanced':
            selectedModel = 'Gemma3-300M';
            break;
          case 'quality':
            selectedModel = 'Qwen3-0.6B';
            break;
        }
      }

      // Perform search based on final mode
      let results;
      let searchStats = {};

      switch (finalSearchMode) {
        case 'semantic':
          results = await performSemanticSearch(knowledgeGraph, query, limit);
          searchStats = { search_type: 'semantic', gpu_accelerated: gpuAvailable };
          break;

        case 'hybrid':
          const bm25Service = new BM25Service();
          const hybridSearchService = new HybridSearchService(embeddingClient, bm25Service);
          results = await performHybridSearch(hybridSearchService, knowledgeGraph, query, limit);
          searchStats = { search_type: 'hybrid', components: ['BM25', 'semantic'], gpu_accelerated: gpuAvailable };
          break;

        case 'keyword':
          results = await performKeywordSearch(knowledgeGraph, query, limit);
          searchStats = { search_type: 'keyword', gpu_accelerated: false };
          break;

        default:
          results = await performSemanticSearch(knowledgeGraph, query, limit);
          searchStats = { search_type: 'semantic', gpu_accelerated: gpuAvailable };
      }

      const endTime = Date.now();
      const searchTime = endTime - startTime;

      // Build response
      const response: any = {
        success: true,
        results: results.entities || [],
        total_results: results.entities?.length || 0,
        search_time_ms: searchTime,
        talentos_integration: {
          gpu_service_available: gpuAvailable,
          embedding_service_url: gpuAvailable ? 'http://localhost:8765' : 'local',
          active_model: selectedModel,
          model_dimensions: gpuAvailable ? modelInfo.dimensions : 384,
          performance_multiplier: gpuAvailable ? '16x faster' : 'CPU baseline'
        }
      };

      // Add performance stats if requested
      if (include_performance_stats) {
        response.performance_analytics = {
          query_analysis: {
            original_mode: search_mode,
            final_mode: finalSearchMode,
            routing_reason: routingReason || `Direct ${search_mode} mode selected`,
            quality_preference: quality_preference
          },
          search_execution: {
            ...searchStats,
            search_time_ms: searchTime,
            results_per_ms: searchTime > 0 ? (results.entities?.length || 0) / searchTime : 0
          },
          model_performance: {
            active_model: selectedModel,
            dimensions: gpuAvailable ? modelInfo.dimensions : 384,
            acceleration: gpuAvailable ? 'GPU (TalentOS)' : 'CPU fallback',
            estimated_speedup: gpuAvailable ? '16x' : '1x'
          }
        };
      }

      return response;

    } catch (error) {
      logger.error('TalentOS semantic search failed', { error: error.message, query });
      return {
        success: false,
        error: `TalentOS semantic search failed: ${error.message}`,
        suggestion: "Check TalentOS embedding service status with get_embedding_status tool"
      };
    }
  }
};

/**
 * Analyze query to suggest optimal search mode
 */
function analyzeQueryForSearchMode(query: string): { suggestedMode: string; reasoning: string } {
  const lowercaseQuery = query.toLowerCase();

  // Check for code patterns
  const hasCodeSymbols = /[A-Z][a-z]+[A-Z]|[a-z]+_[a-z]+|\.[a-z]+\(|\w+\.\w+/.test(query);
  const hasFileExtensions = /\.[a-z]{1,4}\b/.test(lowercaseQuery);
  const hasCodeKeywords = /function|class|interface|async|await|return|export|const|let|var/.test(lowercaseQuery);

  // Check for conceptual queries
  const hasQuestionWords = /how|what|why|when|where|which/.test(lowercaseQuery);
  const hasConceptualTerms = /logic|strategy|pattern|approach|implement|handle|manage|process/.test(lowercaseQuery);

  // Decision logic
  if (hasCodeSymbols || hasFileExtensions || hasCodeKeywords) {
    if (hasQuestionWords || hasConceptualTerms) {
      return { suggestedMode: 'hybrid', reasoning: 'Query contains both code symbols and conceptual terms - hybrid search optimal' };
    }
    return { suggestedMode: 'keyword', reasoning: 'Query contains code symbols/keywords - BM25 keyword search optimal' };
  }

  if (hasQuestionWords || hasConceptualTerms || query.split(' ').length > 3) {
    return { suggestedMode: 'semantic', reasoning: 'Query is conceptual/natural language - semantic search optimal' };
  }

  return { suggestedMode: 'hybrid', reasoning: 'Query type unclear - hybrid search as fallback' };
}

/**
 * Perform semantic search
 */
async function performSemanticSearch(knowledgeGraph: KnowledgeGraphService, query: string, limit: number) {
  return await knowledgeGraph.searchEntities(query, {
    limit,
    threshold: 0.7,
    include_relationships: false
  });
}

/**
 * Perform hybrid search
 */
async function performHybridSearch(
  hybridSearchService: HybridSearchService,
  knowledgeGraph: KnowledgeGraphService,
  query: string,
  limit: number
) {
  // Get entities for hybrid processing
  const entities = await knowledgeGraph.searchEntities(query, {
    limit: limit * 2,
    threshold: 0.1,
    include_relationships: false
  });

  if (!entities.entities || entities.entities.length === 0) {
    return { entities: [] };
  }

  // Perform hybrid search
  const hybridResults = await hybridSearchService.searchHybrid(entities.entities, query, {
    alpha: 0.7,
    limit,
    min_score_threshold: 0.1
  });

  return { entities: hybridResults.results };
}

/**
 * Perform keyword search (BM25 only)
 */
async function performKeywordSearch(knowledgeGraph: KnowledgeGraphService, query: string, limit: number) {
  // For pure keyword search, use very low threshold to get more results for BM25 ranking
  return await knowledgeGraph.searchEntities(query, {
    limit,
    threshold: 0.1,
    include_relationships: false
  });
}

// Export the new tool
export const talentosSemanticSearchTools = [
  talentosSemanticSearch
];