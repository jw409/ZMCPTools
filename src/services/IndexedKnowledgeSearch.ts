/**
 * Indexed Knowledge Search Service
 * Searches the indexed_knowledge.json data (GitHub issues + markdown docs)
 * with hybrid BM25 + gemma_embed semantic search
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../utils/logger.js';
import { EmbeddingClient } from './EmbeddingClient.js';

const logger = new Logger('indexed-knowledge-search');

export interface IndexedDocument {
  id: string;
  type: 'github_issue' | 'markdown_file';
  title?: string;
  content: string;
  embedding?: number[];
  // GitHub issue fields
  repo?: string;
  number?: number;
  state?: string;
  labels?: string[];
  // Markdown file fields
  file_path?: string;
  relative_path?: string;
  size?: number;
  modified?: string;
}

export interface SearchResult {
  document: IndexedDocument;
  score: number;
  matchType: 'bm25' | 'semantic' | 'hybrid';
  bm25Score?: number;
  semanticScore?: number;
}

export interface SearchOptions {
  limit?: number;
  useBm25?: boolean;
  useSemanticSearch?: boolean;
  bm25Weight?: number;
  semanticWeight?: number;
  minScoreThreshold?: number;
}

/**
 * Simple BM25 scoring for text search
 */
function bm25Score(query: string, document: string): number {
  const queryTerms = query.toLowerCase().split(/\s+/);
  const docText = document.toLowerCase();

  let score = 0;
  for (const term of queryTerms) {
    if (docText.includes(term)) {
      // Simple frequency-based scoring
      const termCount = (docText.match(new RegExp(term, 'g')) || []).length;
      score += termCount / (termCount + 1); // Diminishing returns
    }
  }

  return score / queryTerms.length; // Normalize by query length
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Search service for indexed knowledge
 */
export class IndexedKnowledgeSearch {
  private documents: IndexedDocument[] | null = null;
  private embeddingClient: EmbeddingClient;
  private indexPath: string;

  constructor(repositoryPath: string) {
    this.indexPath = path.join(repositoryPath, '../var/storage/indexed_knowledge.json');
    this.embeddingClient = new EmbeddingClient();
  }

  /**
   * Load documents from indexed_knowledge.json
   */
  private async loadDocuments(): Promise<IndexedDocument[]> {
    if (this.documents) {
      return this.documents;
    }

    try {
      const data = await fs.readFile(this.indexPath, 'utf-8');
      this.documents = JSON.parse(data);
      logger.info(`Loaded ${this.documents!.length} documents from indexed knowledge`);
      return this.documents!;
    } catch (error) {
      logger.error('Failed to load indexed knowledge:', error.message);
      return [];
    }
  }

  /**
   * Perform BM25 text search
   */
  private async searchBM25(query: string, documents: IndexedDocument[], limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    for (const doc of documents) {
      const searchText = `${doc.title || ''} ${doc.content}`;
      const score = bm25Score(query, searchText);

      if (score > 0) {
        results.push({
          document: doc,
          score,
          matchType: 'bm25',
          bm25Score: score
        });
      }
    }

    // Sort by score and take top results
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Perform semantic search using embeddings
   */
  private async searchSemantic(query: string, documents: IndexedDocument[], limit: number): Promise<SearchResult[]> {
    // Check if GPU service is available
    const gpuAvailable = await this.embeddingClient.checkGPUService();
    if (!gpuAvailable) {
      logger.warn('GPU embedding service not available - semantic search disabled');
      return [];
    }

    // Get query embedding
    const queryEmbeddingResult = await this.embeddingClient.generateEmbeddings([query]);
    if (!queryEmbeddingResult.embeddings || queryEmbeddingResult.embeddings.length === 0) {
      logger.error('Failed to generate query embedding');
      return [];
    }

    const queryEmbedding = queryEmbeddingResult.embeddings[0];
    const results: SearchResult[] = [];

    // Calculate similarity with each document
    for (const doc of documents) {
      if (!doc.embedding) continue;

      const similarity = cosineSimilarity(queryEmbedding, doc.embedding);
      if (similarity > 0) {
        results.push({
          document: doc,
          score: similarity,
          matchType: 'semantic',
          semanticScore: similarity
        });
      }
    }

    // Sort by score and take top results
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Hybrid search combining BM25 and semantic search
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const {
      limit = 10,
      useBm25 = true,
      useSemanticSearch = true,
      bm25Weight = 0.3,
      semanticWeight = 0.7,
      minScoreThreshold = 0.0
    } = options;

    logger.info('Starting indexed knowledge search', { query, options });

    // Load documents
    const documents = await this.loadDocuments();
    if (documents.length === 0) {
      return [];
    }

    // Perform searches
    const [bm25Results, semanticResults] = await Promise.all([
      useBm25 ? this.searchBM25(query, documents, limit * 2) : Promise.resolve([]),
      useSemanticSearch ? this.searchSemantic(query, documents, limit * 2) : Promise.resolve([])
    ]);

    // Combine results if hybrid mode
    if (useBm25 && useSemanticSearch) {
      const combinedMap = new Map<string, SearchResult>();

      // Add BM25 results
      for (const result of bm25Results) {
        combinedMap.set(result.document.id, {
          ...result,
          score: result.bm25Score! * bm25Weight,
          matchType: 'hybrid'
        });
      }

      // Merge semantic results
      for (const result of semanticResults) {
        const existing = combinedMap.get(result.document.id);
        if (existing) {
          existing.score += result.semanticScore! * semanticWeight;
          existing.semanticScore = result.semanticScore;
        } else {
          combinedMap.set(result.document.id, {
            ...result,
            score: result.semanticScore! * semanticWeight,
            matchType: 'hybrid',
            bm25Score: 0
          });
        }
      }

      const combined = Array.from(combinedMap.values())
        .filter(r => r.score >= minScoreThreshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      logger.info(`Hybrid search complete: ${combined.length} results`);
      return combined;
    }

    // Return single search results
    const results = useBm25 ? bm25Results : semanticResults;
    const filtered = results.filter(r => r.score >= minScoreThreshold).slice(0, limit);
    logger.info(`Search complete: ${filtered.length} results`);
    return filtered;
  }
}
