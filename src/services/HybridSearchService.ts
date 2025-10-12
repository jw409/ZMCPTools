/**
 * Hybrid Search Service
 * Combines dense embeddings (semantic) with BM25 sparse search (keyword)
 * Uses Reciprocal Rank Fusion for optimal result ranking
 */

import { Logger } from '../utils/logger.js';
import { EmbeddingClient } from './EmbeddingClient.js';
import { BM25Service } from './BM25Service.js';
import { VectorSearchService } from './VectorSearchService.js';
import type { BM25Document, BM25SearchResult } from './BM25Service.js';
// Define DocumentMetadata interface locally
export interface DocumentMetadata {
  [key: string]: any;
}

export interface HybridSearchConfig {
  alpha: number;  // Weight for dense embeddings (0.0 = sparse only, 1.0 = dense only)
  k: number;      // RRF parameter (default: 60)
  dense_weight: number;    // Weight for dense scores
  sparse_weight: number;   // Weight for sparse scores
  min_score_threshold: number;  // Minimum combined score threshold
  max_results: number;     // Maximum results to return
  use_reranker: boolean;   // Apply Qwen3-4B reranker for quality boost (default: true)
}

export interface HybridSearchResult {
  id: string;
  text: string;
  combined_score: number;
  dense_score?: number;
  sparse_score?: number;
  dense_rank?: number;
  sparse_rank?: number;
  reranker_score?: number;  // Qwen3-4B reranker score (0.0-1.0)
  final_rank?: number;      // Final rank after reranking
  metadata?: Record<string, any>;
}

export interface SearchStats {
  dense_results: number;
  sparse_results: number;
  combined_results: number;
  dense_time_ms: number;
  sparse_time_ms: number;
  fusion_time_ms: number;
  reranker_time_ms?: number;  // Time spent reranking (if enabled)
  reranker_applied: boolean;  // Whether reranking was applied
  total_time_ms: number;
}

export class HybridSearchService {
  private logger: Logger;
  private embeddingClient: EmbeddingClient;
  private bm25Service: BM25Service;
  private vectorSearchService?: VectorSearchService;

  private readonly DEFAULT_CONFIG: HybridSearchConfig = {
    alpha: 0.7,              // 70% dense, 30% sparse
    k: 60,                   // Standard RRF parameter
    dense_weight: 1.0,
    sparse_weight: 1.0,
    min_score_threshold: 0.1,
    max_results: 50,
    use_reranker: true      // Quality first - local GPU is superfast
  };

  constructor(
    embeddingClient?: EmbeddingClient,
    bm25Service?: BM25Service,
    vectorSearchService?: VectorSearchService
  ) {
    this.logger = new Logger('hybrid-search');
    this.embeddingClient = embeddingClient || new EmbeddingClient();
    this.bm25Service = bm25Service || new BM25Service();
    this.vectorSearchService = vectorSearchService;
  }

  /**
   * Index document for both dense and sparse search
   */
  async indexDocument(
    id: string,
    text: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      // Index for BM25 sparse search
      const bm25Doc: BM25Document = {
        id,
        text,
        metadata
      };
      await this.bm25Service.indexDocument(bm25Doc);

      // Index for dense vector search if VectorSearchService is available
      if (this.vectorSearchService) {
        await this.vectorSearchService.addDocuments('hybrid_search', [{
          id,
          content: text,
          metadata
        }]);
      }

      this.logger.debug('Document indexed for hybrid search', {
        id,
        textLength: text.length,
        hasVectorSearch: !!this.vectorSearchService
      });

    } catch (error) {
      this.logger.error('Failed to index document for hybrid search', { id, error });
      throw error;
    }
  }

  /**
   * Batch index multiple documents
   */
  async indexDocuments(documents: Array<{
    id: string;
    text: string;
    metadata?: Record<string, any>;
  }>): Promise<void> {
    try {
      // Batch index for BM25
      const bm25Docs = documents.map(doc => ({
        id: doc.id,
        text: doc.text,
        metadata: doc.metadata
      }));

      await this.bm25Service.indexDocuments(bm25Docs);

      // Batch index for vector search if available
      if (this.vectorSearchService) {
        const vectorDocs = documents.map(doc => ({
          id: doc.id,
          content: doc.text,
          metadata: doc.metadata
        }));
        await this.vectorSearchService.addDocuments('hybrid_search', vectorDocs);
      }

      this.logger.info('Batch indexing completed for hybrid search', {
        documentCount: documents.length,
        hasVectorSearch: !!this.vectorSearchService
      });

    } catch (error) {
      this.logger.error('Failed to batch index documents', { count: documents.length, error });
      throw error;
    }
  }

  /**
   * Perform hybrid search combining dense and sparse results
   */
  async search(
    query: string,
    config?: Partial<HybridSearchConfig>
  ): Promise<{
    results: HybridSearchResult[];
    stats: SearchStats;
  }> {
    const searchConfig = { ...this.DEFAULT_CONFIG, ...config };
    const totalStartTime = Date.now();

    try {
      // Parallel execution of dense and sparse search
      const [denseResults, sparseResults] = await Promise.all([
        this.performDenseSearch(query, searchConfig.max_results * 2),
        this.performSparseSearch(query, searchConfig.max_results * 2)
      ]);

      const fusionStartTime = Date.now();

      // Combine results using Reciprocal Rank Fusion
      const combinedResults = this.reciprocalRankFusion(
        denseResults.results,
        sparseResults.results,
        searchConfig
      );

      // Filter by minimum score and get candidates for reranking
      const filteredResults = combinedResults
        .filter(result => result.combined_score >= searchConfig.min_score_threshold)
        .slice(0, searchConfig.max_results * 2); // Get 2x results for reranking

      // Apply reranking if enabled
      let finalResults = filteredResults;
      let rerankerTimeMs: number | undefined;
      let rerankerApplied = false;

      if (searchConfig.use_reranker && filteredResults.length > 0) {
        const rerankerStartTime = Date.now();
        try {
          // Extract document texts for reranking
          const documents = filteredResults.map(r => r.text);

          // Rerank using Qwen3-4B
          const reranked = await this.embeddingClient.rerank(
            query,
            documents,
            searchConfig.max_results // Return only top-k after reranking
          );

          // Merge reranker scores with original results
          finalResults = reranked.map((rr, index) => {
            const originalResult = filteredResults[rr.original_index];
            return {
              ...originalResult,
              reranker_score: rr.score,
              final_rank: rr.rank,
              combined_score: rr.score // Use reranker score as final score
            };
          });

          rerankerTimeMs = Date.now() - rerankerStartTime;
          rerankerApplied = true;

          this.logger.debug('Reranking completed', {
            candidates: filteredResults.length,
            reranked: finalResults.length,
            time_ms: rerankerTimeMs
          });
        } catch (error) {
          this.logger.warn('Reranking failed, using RRF results', { error });
          finalResults = filteredResults.slice(0, searchConfig.max_results);
        }
      } else {
        finalResults = filteredResults.slice(0, searchConfig.max_results);
      }

      const totalEndTime = Date.now();

      const stats: SearchStats = {
        dense_results: denseResults.results.length,
        sparse_results: sparseResults.results.length,
        combined_results: finalResults.length,
        dense_time_ms: denseResults.time_ms,
        sparse_time_ms: sparseResults.time_ms,
        fusion_time_ms: fusionStartTime ? (Date.now() - fusionStartTime) : 0,
        reranker_time_ms: rerankerTimeMs,
        reranker_applied: rerankerApplied,
        total_time_ms: totalEndTime - totalStartTime
      };

      this.logger.debug('Hybrid search completed', {
        query: query.substring(0, 50),
        config: searchConfig,
        stats
      });

      return {
        results: finalResults,
        stats
      };

    } catch (error) {
      this.logger.error('Hybrid search failed', { query, error });
      throw error;
    }
  }

  /**
   * Search using only dense embeddings
   */
  async searchDenseOnly(
    query: string,
    limit: number = 20
  ): Promise<HybridSearchResult[]> {
    const result = await this.performDenseSearch(query, limit);
    return result.results.map((r, index) => ({
      id: r.id,
      text: r.text,
      combined_score: r.dense_score || 0,
      dense_score: r.dense_score,
      dense_rank: index + 1,
      metadata: r.metadata
    }));
  }

  /**
   * Search using only BM25 sparse search
   */
  async searchSparseOnly(
    query: string,
    limit: number = 20
  ): Promise<HybridSearchResult[]> {
    const result = await this.performSparseSearch(query, limit);
    return result.results.map((r, index) => ({
      id: r.id,
      text: r.text,
      combined_score: r.sparse_score || 0,
      sparse_score: r.sparse_score,
      sparse_rank: index + 1,
      metadata: r.metadata
    }));
  }

  /**
   * Perform dense embedding search using VectorSearchService
   */
  private async performDenseSearch(
    query: string,
    limit: number
  ): Promise<{
    results: Array<{
      id: string;
      text: string;
      dense_score: number;
      metadata?: Record<string, any>;
    }>;
    time_ms: number;
  }> {
    const startTime = Date.now();

    try {
      // If VectorSearchService is not available, return empty results
      if (!this.vectorSearchService) {
        this.logger.warn('VectorSearchService not available - dense search disabled');
        return {
          results: [],
          time_ms: Date.now() - startTime
        };
      }

      // Perform vector similarity search via VectorSearchService
      // Uses LanceDB with Qwen3-Embedding-4B (2560D) when GPU is available
      // Falls back to Xenova/all-MiniLM-L6-v2 (384D) otherwise
      const vectorResults = await this.vectorSearchService.search(
        query,
        undefined,  // Search across all collections
        limit,
        0.3        // Minimum similarity threshold
      );

      // Convert VectorSearchService results to HybridSearchService format
      const results = vectorResults.map(result => ({
        id: result.id,
        text: result.content,
        dense_score: result.similarity,  // Use similarity as score (0.0-1.0)
        metadata: result.metadata
      }));

      const endTime = Date.now();

      this.logger.debug('Dense search completed', {
        query: query.substring(0, 50),
        resultCount: results.length,
        time_ms: endTime - startTime
      });

      return {
        results,
        time_ms: endTime - startTime
      };

    } catch (error) {
      this.logger.error('Dense search failed', { query, error });
      return {
        results: [],
        time_ms: Date.now() - startTime
      };
    }
  }

  /**
   * Perform BM25 sparse search
   */
  private async performSparseSearch(
    query: string,
    limit: number
  ): Promise<{
    results: Array<{
      id: string;
      text: string;
      sparse_score: number;
      metadata?: Record<string, any>;
    }>;
    time_ms: number;
  }> {
    const startTime = Date.now();

    try {
      const bm25Results = await this.bm25Service.search(query, limit);

      const results = bm25Results.map(result => ({
        id: result.id,
        text: result.text,
        sparse_score: result.score,
        metadata: result.metadata
      }));

      const endTime = Date.now();

      return {
        results,
        time_ms: endTime - startTime
      };

    } catch (error) {
      this.logger.error('Sparse search failed', { query, error });
      return {
        results: [],
        time_ms: Date.now() - startTime
      };
    }
  }

  /**
   * Combine dense and sparse results using Reciprocal Rank Fusion
   */
  private reciprocalRankFusion(
    denseResults: Array<{
      id: string;
      text: string;
      dense_score: number;
      metadata?: Record<string, any>;
    }>,
    sparseResults: Array<{
      id: string;
      text: string;
      sparse_score: number;
      metadata?: Record<string, any>;
    }>,
    config: HybridSearchConfig
  ): HybridSearchResult[] {
    // Create maps for efficient lookup
    const denseMap = new Map(denseResults.map((r, index) => [
      r.id,
      { ...r, rank: index + 1 }
    ]));

    const sparseMap = new Map(sparseResults.map((r, index) => [
      r.id,
      { ...r, rank: index + 1 }
    ]));

    // Get all unique document IDs
    const allIds = new Set([
      ...denseResults.map(r => r.id),
      ...sparseResults.map(r => r.id)
    ]);

    // Calculate RRF scores for each document
    const combinedResults: HybridSearchResult[] = [];

    for (const id of allIds) {
      const denseResult = denseMap.get(id);
      const sparseResult = sparseMap.get(id);

      // Calculate RRF score
      let rrfScore = 0;

      if (denseResult) {
        rrfScore += config.dense_weight / (config.k + denseResult.rank);
      }

      if (sparseResult) {
        rrfScore += config.sparse_weight / (config.k + sparseResult.rank);
      }

      // Apply alpha weighting
      const finalScore = config.alpha * (denseResult?.dense_score || 0) +
                        (1 - config.alpha) * (sparseResult?.sparse_score || 0) +
                        rrfScore;

      // Get text and metadata (prefer dense result, fallback to sparse)
      const text = denseResult?.text || sparseResult?.text || '';
      const metadata = denseResult?.metadata || sparseResult?.metadata;

      combinedResults.push({
        id,
        text,
        combined_score: finalScore,
        dense_score: denseResult?.dense_score,
        sparse_score: sparseResult?.sparse_score,
        dense_rank: denseResult?.rank,
        sparse_rank: sparseResult?.rank,
        metadata
      });
    }

    // Sort by combined score (descending)
    return combinedResults.sort((a, b) => b.combined_score - a.combined_score);
  }

  /**
   * Get search statistics
   */
  getStatistics(): {
    bm25_stats: ReturnType<BM25Service['getStatistics']>;
    // Add dense embedding stats when available
  } {
    return {
      bm25_stats: this.bm25Service.getStatistics()
    };
  }

  /**
   * Wrapper method for backward compatibility - calls the main search method
   */
  async searchHybrid(
    documents: any[],
    query: string,
    options: {
      alpha?: number;
      limit?: number;
      min_score_threshold?: number;
    } = {}
  ): Promise<any[]> {
    const result = await this.search(query, {
      alpha: options.alpha,
      max_results: options.limit,
      min_score_threshold: options.min_score_threshold
    });
    return result.results;
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    try {
      this.bm25Service.close();
      // Close embedding client if it has a close method
      this.logger.info('Hybrid search service closed');
    } catch (error) {
      this.logger.error('Error closing hybrid search service', { error });
    }
  }
}