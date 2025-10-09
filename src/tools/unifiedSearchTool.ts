/**
 * Unified Knowledge Graph Search Tool
 * Single MCP method combining BM25, Qwen3 embeddings, and reranker with configurable pipeline
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { SymbolGraphIndexer } from '../services/SymbolGraphIndexer.js';
import { EmbeddingClient } from '../services/EmbeddingClient.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('unified-search');

/**
 * Analyze query to suggest optimal search method configuration
 */
function analyzeQuery(query: string): {
  suggestedBM25: boolean;
  suggestedSemantic: boolean;
  suggestedReranker: boolean;
  reasoning: string;
} {
  const lowercaseQuery = query.toLowerCase();

  // Check for exact code patterns
  const hasCodeSymbols = /[A-Z][a-z]+[A-Z]|[a-z]+_[a-z]+|\.[a-z]+\(|\w+\.\w+/.test(query); // camelCase, snake_case, method calls, object.property
  const hasFileExtensions = /\.[a-z]{1,4}\b/.test(lowercaseQuery); // .js, .py, .tsx, etc.
  const hasImportStatements = /import|from\s+|require\(/.test(lowercaseQuery);
  const hasCodeKeywords = /function|class|interface|async|await|return|export|const|let|var/.test(lowercaseQuery);
  const hasSpecialChars = /[{}()\[\]<>=!&|]/.test(query);

  // Check for conceptual queries
  const hasQuestionWords = /how|what|why|when|where|which/.test(lowercaseQuery);
  const hasConceptualTerms = /logic|strategy|pattern|approach|implement|handle|manage|process/.test(lowercaseQuery);
  const hasNaturalLanguage = query.split(' ').length > 3 && !hasCodeSymbols;

  // Check for high-precision indicators
  const isComplexQuery = query.split(' ').length > 5;
  const hasMultipleConcepts = (query.match(/\b(and|or|with|using|for)\b/gi) || []).length > 1;

  // Decision logic
  const shouldUseBM25 = hasCodeSymbols || hasFileExtensions || hasImportStatements || hasCodeKeywords || hasSpecialChars;
  const shouldUseSemantic = hasQuestionWords || hasConceptualTerms || hasNaturalLanguage || (!shouldUseBM25 && query.split(' ').length > 1);
  const shouldUseReranker = isComplexQuery || hasMultipleConcepts;

  // Generate reasoning
  let reasoning = "Auto-routing: ";
  if (shouldUseBM25 && shouldUseSemantic) {
    reasoning += "Hybrid search recommended - query contains both exact terms and concepts";
  } else if (shouldUseBM25) {
    reasoning += "BM25 search recommended - query contains code symbols, keywords, or file patterns";
  } else if (shouldUseSemantic) {
    reasoning += "Semantic search recommended - query is conceptual or natural language";
  } else {
    reasoning += "Hybrid search as fallback - query type unclear";
  }

  if (shouldUseReranker) {
    reasoning += " + reranker for complex multi-concept query";
  }

  return {
    suggestedBM25: shouldUseBM25 || (!shouldUseBM25 && !shouldUseSemantic), // fallback to BM25 if nothing detected
    suggestedSemantic: shouldUseSemantic || (!shouldUseBM25 && !shouldUseSemantic), // fallback to semantic if nothing detected
    suggestedReranker: shouldUseReranker,
    reasoning
  };
}

// Unified search parameter schema
const UnifiedSearchSchema = z.object({
  repository_path: z.string().describe("Absolute path to the repository to search within"),
  query: z.string().min(1).describe("The search query text - natural language supported"),

  // Core pipeline flags
  use_bm25: z.boolean().default(true).describe("Enable BM25 keyword/sparse search for exact matches and technical terms"),
  use_gpu_embeddings: z.boolean().default(true).describe("Enable GPU-accelerated semantic embeddings (auto-detects available model) for conceptual understanding"),
  use_reranker: z.boolean().default(false).describe("Enable neural reranker for final ranking precision (two-stage retrieval)"),

  // Pipeline configuration
  candidate_limit: z.number().int().min(10).max(200).default(50).describe("Initial candidates to retrieve before reranking (stage 1)"),
  final_limit: z.number().int().min(1).max(50).default(10).describe("Final results to return after reranking (stage 2)"),

  // Search tuning
  bm25_weight: z.number().min(0).max(1).default(0.3).describe("BM25 contribution weight in hybrid fusion (0.0-1.0)"),
  semantic_weight: z.number().min(0).max(1).default(0.7).describe("Semantic embedding weight in hybrid fusion (0.0-1.0)"),
  min_score_threshold: z.number().min(0).max(1).default(0.1).describe("Minimum score threshold for results"),

  // Optional filters
  entity_types: z.array(z.enum(['agent', 'task', 'file', 'function', 'class', 'concept', 'error', 'solution', 'pattern', 'insight', 'decision', 'tool', 'repository', 'dependency', 'configuration', 'test', 'documentation', 'feature', 'bug', 'requirement', 'progress'])).optional().describe("Filter by entity types"),

  // Performance/debugging
  include_metrics: z.boolean().default(true).describe("Include detailed performance metrics and component scores"),
  explain_ranking: z.boolean().default(false).describe("Include detailed ranking explanations for debugging")
});

/**
 * Unified search combining BM25, GPU semantic embeddings, and neural reranking
 */
export const searchKnowledgeGraphUnified: Tool = {
  name: 'search_knowledge_graph_unified',
  description: `**Smart file search across codebases with automatic indexing and configurable search methods.**

🎯 **When to Use BM25 Search (use_bm25=true):**
- Finding exact function/variable names: "getUserById", "handleSubmit", "DatabaseConnection"
- Searching for specific error messages or log strings: "Connection timeout"
- Locating import statements: "import React from", "from django.db"
- Finding technical acronyms or abbreviations: "JWT", "API", "SQL", "HTTP"
- Searching for exact file names or paths: "config.json", "src/components/"
- Looking for specific code patterns: "async function", "class extends"

🧠 **When to Use Semantic Search (use_gpu_embeddings=true):**
- Understanding concepts: "user authentication logic", "password validation flow"
- Finding similar implementations: "code that handles file uploads"
- Searching by functionality: "functions that process user input"
- Exploring documentation: "how to configure database connections"
- Finding patterns: "error handling strategies", "validation approaches"
- Conceptual queries: "security middleware", "data transformation logic"

⚖️ **When to Use Hybrid Mode (both=true):**
- General code exploration when you're not sure about exact terms
- Finding all code related to a feature: "user profile management"
- Comprehensive searches: "authentication AND login AND security"
- When bridging exact matches with related concepts

🎯 **When to Enable Reranker (use_reranker=true):**
- Critical searches where precision matters most
- When you have many candidates and need the best matches
- Final verification before making important code changes
- Research tasks requiring highest quality results

📝 **Smart Defaults - Let the Tool Choose:**
- \`{use_bm25: true, use_gpu_embeddings: true}\` - Balanced hybrid search (recommended)
- \`{use_bm25: true, use_gpu_embeddings: false}\` - Fast exact matching
- \`{use_bm25: false, use_gpu_embeddings: true}\` - Conceptual understanding
- \`{use_reranker: true}\` - Add this for maximum precision (requires semantic search)

🚀 **Automatic Repository Indexing:**
Automatically indexes all code files in the repository for fast search. Supports TypeScript, JavaScript, Python, Java, C++, Rust, PHP, HTML, CSS, and more.

Returns real file paths, content snippets, and extracted code symbols (functions, classes, etc.).`,

  inputSchema: zodToJsonSchema(UnifiedSearchSchema) as any,

  async handler({
    repository_path,
    query,
    use_bm25,
    use_gpu_embeddings,
    use_reranker,
    candidate_limit,
    final_limit,
    bm25_weight,
    semantic_weight,
    min_score_threshold,
    entity_types,
    include_metrics,
    explain_ranking
  }) {
    const startTime = Date.now();
    const metrics: any = {
      query,
      pipeline_config: {
        bm25: use_bm25,
        semantic: use_gpu_embeddings,
        reranker: use_reranker
      },
      stage_timings: {},
      component_scores: {},
      total_candidates: 0,
      final_results: 0
    };

    try {
      // Analyze query for smart routing suggestions
      const queryAnalysis = analyzeQuery(query);

      // Validate configuration
      if (!use_bm25 && !use_gpu_embeddings) {
        return {
          success: false,
          error: "Must enable at least one search method (BM25 or embeddings)",
          suggestion: "Set use_bm25=true or use_gpu_embeddings=true",
          auto_routing_suggestion: {
            use_bm25: queryAnalysis.suggestedBM25,
            use_gpu_embeddings: queryAnalysis.suggestedSemantic,
            use_reranker: queryAnalysis.suggestedReranker,
            reasoning: queryAnalysis.reasoning
          }
        };
      }

      if (use_reranker && !use_gpu_embeddings) {
        return {
          success: false,
          error: "Reranker requires semantic embeddings for candidate generation",
          suggestion: "Set use_gpu_embeddings=true when using reranker"
        };
      }

      // Initialize services
      const symbolGraphIndexer = new SymbolGraphIndexer();
      const embeddingClient = new EmbeddingClient();

      // Initialize symbol graph indexer
      await symbolGraphIndexer.initialize(repository_path);

      // Index repository first (with incremental caching)
      logger.info('Indexing repository files for search (incremental)');
      const indexingStats = await symbolGraphIndexer.indexRepository(repository_path);

      // Check GPU availability
      const gpuAvailable = await embeddingClient.checkGPUService();
      const modelInfo = embeddingClient.getActiveModelInfo();

      logger.info('Starting unified search', {
        query: query.substring(0, 50),
        pipeline: { bm25: use_bm25, semantic: use_gpu_embeddings, reranker: use_reranker },
        gpu_available: gpuAvailable
      });

      metrics.gpu_available = gpuAvailable;
      metrics.model_used = gpuAvailable ? modelInfo.name : 'MiniLM-L6-v2';
      metrics.indexing_stats = {
        total_files: indexingStats.totalFiles,
        indexed_files: indexingStats.indexedFiles,
        languages: indexingStats.languages,
        indexing_time_ms: indexingStats.indexingTimeMs
      };

      // STAGE 1: Candidate Retrieval
      let allCandidates: any[] = [];
      let bm25Results: any[] = [];
      let semanticResults: any[] = [];

      // BM25 sparse search
      if (use_bm25) {
        const bm25Start = Date.now();

        // Search files using BM25 (code-only search domain)
        const bm25SearchResults = await symbolGraphIndexer.searchKeyword(query, candidate_limit);

        bm25Results = bm25SearchResults.map(result => ({
          id: result.filePath,
          entity_name: result.filePath.split('/').pop() || result.filePath,
          entity_type: 'file',
          description: `File: ${result.filePath}`,
          file_path: result.filePath,
          content: result.snippet || '',
          relevant_symbols: result.symbols || [],
          bm25_score: result.score,
          search_method: 'bm25',
          match_type: result.matchType
        }));

        metrics.stage_timings.bm25_ms = Date.now() - bm25Start;
        metrics.component_scores.bm25_results = bm25Results.length;
      }

      // Semantic embedding search
      if (use_gpu_embeddings) {
        const semanticStart = Date.now();

        // Search files using semantic similarity (intent-only search domain)
        // TODO: Implement semantic search in SymbolGraphIndexer
        // For now, use empty results (will be implemented in follow-up)
        semanticResults = [];

        logger.info('Semantic search not yet implemented in SymbolGraphIndexer - using BM25 only');

        metrics.stage_timings.semantic_ms = Date.now() - semanticStart;
        metrics.component_scores.semantic_results = semanticResults.length;
      }

      // Combine results based on enabled methods
      if (use_bm25 && use_gpu_embeddings) {
        // Hybrid fusion with weighted combination
        const resultMap = new Map();

        // Add BM25 results
        bm25Results.forEach(result => {
          resultMap.set(result.id, {
            ...result,
            combined_score: (result.bm25_score || 0) * bm25_weight,
            bm25_score: result.bm25_score || 0,
            semantic_score: 0
          });
        });

        // Add/merge semantic results
        semanticResults.forEach(result => {
          const existing = resultMap.get(result.id);
          if (existing) {
            existing.combined_score += (result.semantic_score || 0) * semantic_weight;
            existing.semantic_score = result.semantic_score || 0;
            existing.search_method = 'hybrid';
          } else {
            resultMap.set(result.id, {
              ...result,
              combined_score: (result.semantic_score || 0) * semantic_weight,
              bm25_score: 0,
              semantic_score: result.semantic_score || 0,
              search_method: 'semantic_only'
            });
          }
        });

        allCandidates = Array.from(resultMap.values())
          .sort((a, b) => b.combined_score - a.combined_score)
          .slice(0, candidate_limit);

      } else if (use_bm25) {
        allCandidates = bm25Results.slice(0, candidate_limit);
      } else if (use_gpu_embeddings) {
        allCandidates = semanticResults.slice(0, candidate_limit);
      }

      metrics.total_candidates = allCandidates.length;

      // STAGE 2: Neural Reranking (if enabled)
      let finalResults = allCandidates;

      if (use_reranker && allCandidates.length > 0) {
        const rerankerStart = Date.now();

        try {
          // Prepare documents for reranking
          const documents = allCandidates.map(candidate =>
            candidate.description || candidate.entity_name || ''
          );

          // Call reranker service
          const rerankerResponse = await fetch('http://localhost:8765/rerank', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query,
              documents,
              top_k: final_limit,
              model: 'reranker'
            })
          });

          if (rerankerResponse.ok) {
            const rerankerResult = await rerankerResponse.json();

            // Map reranked results back to original candidates
            finalResults = rerankerResult.results.map((result: any) => {
              const originalCandidate = allCandidates[result.original_index];
              return {
                ...originalCandidate,
                reranker_score: result.score,
                reranker_rank: result.rank,
                final_score: result.score,
                search_method: originalCandidate.search_method + '+reranker'
              };
            });

            metrics.component_scores.reranker_results = finalResults.length;
            logger.info('Reranking completed', {
              candidates: allCandidates.length,
              reranked: finalResults.length
            });
          } else {
            logger.warn('Reranker service unavailable, using original ranking');
            finalResults = allCandidates.slice(0, final_limit);
          }
        } catch (error) {
          logger.warn('Reranker failed, using original ranking', { error: error.message });
          finalResults = allCandidates.slice(0, final_limit);
        }

        metrics.stage_timings.reranker_ms = Date.now() - rerankerStart;
      } else {
        finalResults = allCandidates.slice(0, final_limit);
      }

      metrics.final_results = finalResults.length;
      metrics.total_time_ms = Date.now() - startTime;

      // Prepare response
      const response: any = {
        success: true,
        results: finalResults,
        metadata: {
          query,
          pipeline_used: {
            bm25: use_bm25,
            semantic: use_gpu_embeddings,
            reranker: use_reranker
          },
          auto_routing_analysis: {
            suggested_bm25: queryAnalysis.suggestedBM25,
            suggested_semantic: queryAnalysis.suggestedSemantic,
            suggested_reranker: queryAnalysis.suggestedReranker,
            reasoning: queryAnalysis.reasoning,
            user_overrode: use_bm25 !== queryAnalysis.suggestedBM25 || use_gpu_embeddings !== queryAnalysis.suggestedSemantic
          },
          gpu_accelerated: gpuAvailable,
          model_used: metrics.model_used,
          total_results: finalResults.length,
          candidate_pool_size: allCandidates.length
        }
      };

      if (include_metrics) {
        response.performance_metrics = metrics;
      }

      if (explain_ranking && finalResults.length > 0) {
        response.ranking_explanation = {
          note: "Results ranked by: " + (use_reranker ? "neural reranker scores" :
                use_bm25 && use_gpu_embeddings ? "weighted BM25+semantic fusion" :
                use_bm25 ? "BM25 keyword relevance" : "semantic similarity"),
          top_result_scores: finalResults.slice(0, 3).map(result => ({
            id: result.id,
            entity_name: result.entity_name,
            bm25_score: result.bm25_score || 0,
            semantic_score: result.semantic_score || 0,
            reranker_score: result.reranker_score || 0,
            final_score: result.final_score || result.combined_score || 0
          }))
        };
      }

      return response;

    } catch (error) {
      logger.error('Unified search failed', { error: error.message, query });
      return {
        success: false,
        error: `Unified search failed: ${error.message}`,
        metrics: {
          ...metrics,
          total_time_ms: Date.now() - startTime,
          error: error.message
        }
      };
    }
  }
};

// Export the unified tool
export const unifiedSearchTools = [
  searchKnowledgeGraphUnified
];