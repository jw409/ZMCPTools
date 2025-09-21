/**
 * Hybrid Search Service
 * Combines dense embeddings (semantic) with BM25 sparse search (keyword)
 * Uses Reciprocal Rank Fusion for optimal result ranking
 */

import { Logger } from '../utils/logger.js';
import { EmbeddingClient } from './EmbeddingClient.js';
import { BM25Service, BM25Document, BM25SearchResult } from './BM25Service.js';
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
}

export interface HybridSearchResult {
  id: string;
  text: string;
  combined_score: number;
  dense_score?: number;
  sparse_score?: number;
  dense_rank?: number;
  sparse_rank?: number;
  metadata?: Record<string, any>;
}

export interface SearchStats {
  dense_results: number;
  sparse_results: number;
  combined_results: number;
  dense_time_ms: number;
  sparse_time_ms: number;
  fusion_time_ms: number;
  total_time_ms: number;
}

export class HybridSearchService {
  private logger: Logger;
  private embeddingClient: EmbeddingClient;
  private bm25Service: BM25Service;

  private readonly DEFAULT_CONFIG: HybridSearchConfig = {
    alpha: 0.7,              // 70% dense, 30% sparse
    k: 60,                   // Standard RRF parameter
    dense_weight: 1.0,
    sparse_weight: 1.0,
    min_score_threshold: 0.1,
    max_results: 50
  };

  constructor(embeddingClient?: EmbeddingClient, bm25Service?: BM25Service) {
    this.logger = new Logger('hybrid-search');
    this.embeddingClient = embeddingClient || new EmbeddingClient();
    this.bm25Service = bm25Service || new BM25Service();
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

      // Index for dense embedding search (if supported by EmbeddingClient)
      // Note: This would require extending EmbeddingClient to support indexing
      // For now, we assume embeddings are generated on-demand during search

      this.logger.debug('Document indexed for hybrid search', {
        id,
        textLength: text.length
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

      this.logger.info('Batch indexing completed for hybrid search', {
        documentCount: documents.length
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

      // Filter by minimum score and limit results
      const filteredResults = combinedResults
        .filter(result => result.combined_score >= searchConfig.min_score_threshold)
        .slice(0, searchConfig.max_results);

      const totalEndTime = Date.now();

      const stats: SearchStats = {
        dense_results: denseResults.results.length,
        sparse_results: sparseResults.results.length,
        combined_results: filteredResults.length,
        dense_time_ms: denseResults.time_ms,
        sparse_time_ms: sparseResults.time_ms,
        fusion_time_ms: totalEndTime - fusionStartTime,
        total_time_ms: totalEndTime - totalStartTime
      };

      this.logger.debug('Hybrid search completed', {
        query: query.substring(0, 50),
        config: searchConfig,
        stats
      });

      return {
        results: filteredResults,
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
   * Perform dense embedding search
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
      // Generate query embedding
      const queryEmbedding = await this.embeddingClient.embedTexts([query]);

      if (!queryEmbedding || queryEmbedding.embeddings.length === 0) {
        throw new Error('Failed to generate query embedding');
      }

      // For now, return empty results as we need to implement
      // vector similarity search in the embedding client
      // This would typically involve querying a vector database
      const results: Array<{
        id: string;
        text: string;
        dense_score: number;
        metadata?: Record<string, any>;
      }> = [];

      const endTime = Date.now();

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