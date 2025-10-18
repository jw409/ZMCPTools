/**
 * BM25 Sparse Embedding Service
 * Provides fast keyword-based search to complement dense embeddings
 * Uses SQLite FTS5 for persistence and fast text matching
 *
 * SYMBOL-AWARE ENHANCEMENT:
 * Integrates with SymbolIndexRepository to achieve 80% code recall (vs 60% naive BM25)
 * by distinguishing files that DEFINE symbols vs files that only USE symbols.
 */

import { Logger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import Database from 'better-sqlite3';
import { StoragePathResolver } from './StoragePathResolver.js';
import { SymbolIndexRepository } from '../repositories/SymbolIndexRepository.js';
import type { FileSymbolMetadata } from '../repositories/SymbolIndexRepository.js';
import { DatabaseManager } from '../database/index.js';

export interface BM25Document {
  id: string;
  text: string;
  metadata?: Record<string, any>;
}

export interface BM25SearchResult {
  id: string;
  text: string;
  score: number;
  metadata?: Record<string, any>;
}

export interface BM25Config {
  database_path: string;
  k1: number;  // Term frequency saturation parameter (default: 1.2)
  b: number;   // Length normalization parameter (default: 0.75)
  min_term_length: number;  // Minimum term length to index (default: 2)
  max_terms_per_doc: number;  // Maximum terms per document (default: 1000)
}

export class BM25Service {
  private logger: Logger;
  private db: Database.Database;
  private config: BM25Config;
  private mcptoolsDir: string;
  private symbolRepository?: SymbolIndexRepository;

  private readonly DEFAULT_CONFIG: BM25Config = {
    database_path: '',  // Will be set in constructor
    k1: 1.2,
    b: 0.75,
    min_term_length: 2,
    max_terms_per_doc: 1000
  };

  constructor(dbManager: DatabaseManager, drizzleDb?: any, projectPath?: string) {
    this.logger = new Logger('bm25-service');
    this.mcptoolsDir = path.join(homedir(), '.mcptools');

    // Use StoragePathResolver for project-local isolation
    const storageConfig = StoragePathResolver.getStorageConfig({ preferLocal: true, projectPath });
    const defaultDbPath = StoragePathResolver.getSQLitePath(storageConfig, 'bm25_index');

    this.config = {
      ...this.DEFAULT_CONFIG,
      database_path: defaultDbPath,
    };

    this.logger.info('BM25Service initialized', {
      databasePath: this.config.database_path,
      projectPath,
      preferLocal: true
    });

    // Initialize symbol repository for symbol-aware search
    if (dbManager) {
      this.symbolRepository = new SymbolIndexRepository(dbManager);
      this.logger.info('Symbol-aware search enabled');
    }

    // Ensure storage directories exist
    StoragePathResolver.ensureStorageDirectories(storageConfig);

    this.initializeDatabase();
  }

  private initializeDatabase(): void {
    try {
      // Ensure directory exists
      const dbDir = path.dirname(this.config.database_path);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Initialize SQLite database with FTS5
      this.db = new Database(this.config.database_path);

      // Enable WAL mode for better concurrency
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');

      // Create FTS5 virtual table for full-text search
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS bm25_documents USING fts5(
          id UNINDEXED,
          text,
          metadata UNINDEXED,
          created_at UNINDEXED,
          tokenize = 'porter unicode61 remove_diacritics 1'
        )
      `);

      // Create metadata table for additional document info
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS document_metadata (
          id TEXT PRIMARY KEY,
          metadata TEXT,
          doc_length INTEGER,
          created_at REAL,
          updated_at REAL
        )
      `);

      // Create index on created_at for efficient time-based queries
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_created_at ON document_metadata(created_at)
      `);

      // Log database stats to verify we're using the right database
      const docCount = this.db.prepare('SELECT COUNT(*) as count FROM bm25_documents').get() as { count: number };

      this.logger.info('BM25 database initialized', {
        path: this.config.database_path,
        config: this.config,
        documentCount: docCount.count
      });

    } catch (error) {
      this.logger.error('Failed to initialize BM25 database', { error });
      throw error;
    }
  }

  /**
   * Index a single document for BM25 search
   */
  async indexDocument(doc: BM25Document): Promise<void> {
    try {
      const now = Date.now() / 1000;
      const metadataJson = JSON.stringify(doc.metadata || {});

      // Preprocess text for better indexing
      const processedText = this.preprocessText(doc.text);
      const docLength = processedText.split(/\s+/).length;

      // Insert into FTS5 table
      const insertFTS = this.db.prepare(`
        INSERT OR REPLACE INTO bm25_documents (id, text, metadata, created_at)
        VALUES (?, ?, ?, ?)
      `);

      // Insert into metadata table
      const insertMeta = this.db.prepare(`
        INSERT OR REPLACE INTO document_metadata (id, metadata, doc_length, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      // Use transaction for consistency
      const transaction = this.db.transaction(() => {
        insertFTS.run(doc.id, processedText, metadataJson, now);
        insertMeta.run(doc.id, metadataJson, docLength, now, now);
      });

      transaction();

      this.logger.debug('Document indexed', {
        id: doc.id,
        textLength: doc.text.length,
        docLength: docLength
      });

    } catch (error) {
      this.logger.error('Failed to index document', { docId: doc.id, error });
      throw error;
    }
  }

  /**
   * Index multiple documents in batch
   */
  async indexDocuments(docs: BM25Document[]): Promise<void> {
    if (docs.length === 0) return;

    try {
      const now = Date.now() / 1000;

      const insertFTS = this.db.prepare(`
        INSERT OR REPLACE INTO bm25_documents (id, text, metadata, created_at)
        VALUES (?, ?, ?, ?)
      `);

      const insertMeta = this.db.prepare(`
        INSERT OR REPLACE INTO document_metadata (id, metadata, doc_length, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      const transaction = this.db.transaction(() => {
        for (const doc of docs) {
          const processedText = this.preprocessText(doc.text);
          const docLength = processedText.split(/\s+/).length;
          const metadataJson = JSON.stringify(doc.metadata || {});

          insertFTS.run(doc.id, processedText, metadataJson, now);
          insertMeta.run(doc.id, metadataJson, docLength, now, now);
        }
      });

      transaction();

      this.logger.info('Batch indexing completed', {
        documentCount: docs.length,
        avgLength: docs.reduce((sum, doc) => sum + doc.text.length, 0) / docs.length
      });

    } catch (error) {
      this.logger.error('Failed to batch index documents', { count: docs.length, error });
      throw error;
    }
  }

  /**
   * Search documents using BM25 ranking
   */
  async search(query: string, limit: number = 20, offset: number = 0): Promise<BM25SearchResult[]> {
    try {
      const processedQuery = this.preprocessQuery(query);

      if (!processedQuery.trim()) {
        return [];
      }

      // Use FTS5 BM25 ranking with custom parameters
      // Note: No table alias for FTS5 virtual tables
      const searchQuery = `
        SELECT
          id,
          text,
          metadata,
          bm25(bm25_documents, ?, ?) as score
        FROM bm25_documents
        WHERE bm25_documents MATCH ?
        ORDER BY score
        LIMIT ? OFFSET ?
      `;

      this.logger.debug('BM25 search starting', {
        query: processedQuery,
        limit,
        offset,
        k1: this.config.k1,
        b: this.config.b
      });

      const stmt = this.db.prepare(searchQuery);
      const rows = stmt.all(
        this.config.k1,     // k1 parameter
        this.config.b,      // b parameter
        processedQuery,     // search query
        limit,
        offset
      );

      const results: BM25SearchResult[] = rows.map((row: any) => ({
        id: row.id,
        text: row.text,
        score: -row.score,  // FTS5 BM25 returns negative scores, flip for intuitive ordering
        metadata: row.metadata ? JSON.parse(row.metadata) : {}
      }));

      this.logger.info('BM25 search completed', {
        query: processedQuery,
        resultCount: results.length,
        topScore: results[0]?.score || 0
      });

      return results;

    } catch (error: any) {
      this.logger.error('BM25 search failed', {
        query,
        processedQuery: this.preprocessQuery(query),
        error: error.message,
        stack: error.stack
      });
      return [];
    }
  }

  /**
   * Symbol-aware search (80% code recall vs 60% naive BM25)
   *
   * Applies boost algorithm from benchmarks (default config):
   * - Base BM25 score * 0.3 (content match weight)
   * - +2.0 for file name match (e.g., "ResourceManager" → ResourceManager.ts)
   * - +3.0 for exported symbols (file DEFINES the symbol)
   * - +1.5 for defined symbols (class/function declarations)
   * - +0.5 for all symbols (weaker signal)
   * - *0.3 penalty if file only imports symbol (doesn't define it)
   *
   * ADAPTIVE WEIGHTS: Boost weights can be learned from query feedback.
   * See docs/ADAPTIVE_SEARCH_WEIGHTS.md for details.
   *
   * @param query Search query
   * @param limit Max results to return
   * @param offset Pagination offset
   * @param configName Boost config name (default: 'default', can use 'learned_v1', etc.)
   *
   * Returns results re-ranked by symbol-aware scores.
   */
  async searchSymbolAware(
    query: string,
    limit: number = 20,
    offset: number = 0,
    configName: string = 'default'
  ): Promise<BM25SearchResult[]> {
    // Fall back to regular search if symbol repository not available
    if (!this.symbolRepository) {
      this.logger.warn('Symbol repository not available, falling back to regular search');
      return this.search(query, limit, offset);
    }

    try {
      // Get base BM25 results (fetch more than needed for re-ranking)
      const baseResults = await this.search(query, limit * 3, 0);

      if (baseResults.length === 0) {
        return [];
      }

      // Extract query terms for symbol matching
      const processedQuery = this.preprocessQuery(query);
      const queryTerms = processedQuery.toLowerCase().split(/\s+/).filter(t => t.length >= 2);

      // Fetch symbol metadata for all result files
      const filePaths = baseResults.map(r => r.id);
      const symbolMetadata = await this.symbolRepository.getMultipleFileSymbols(filePaths);

      // Get boost configuration (supports multiple configs for A/B testing)
      const boostConfig = await this.symbolRepository.getBoostConfig(configName);

      this.logger.debug('Using boost configuration', {
        configName,
        weights: {
          fileName: boostConfig.file_name_match_boost,
          exported: boostConfig.exported_symbol_boost,
          defined: boostConfig.defined_symbol_boost
        }
      });

      // Apply symbol-aware scoring
      const rerankedResults = baseResults.map(result => {
        const baseScore = result.score;
        const filePath = result.id;
        const fileName = path.basename(filePath).toLowerCase();
        const symbolInfo = symbolMetadata.get(filePath);

        // Start with base BM25 score weighted by content_match_weight
        let symbolAwareScore = baseScore * boostConfig.content_match_weight;

        if (symbolInfo) {
          // Process each query term
          for (const term of queryTerms) {
            // File name match boost
            if (fileName.includes(term)) {
              symbolAwareScore += boostConfig.file_name_match_boost;
            }

            // Check if term matches any symbols
            const matchesExported = symbolInfo.exportedSymbols.some(s => s.includes(term));
            const matchesDefined = symbolInfo.definedSymbols.some(s => s.includes(term));
            const matchesImported = symbolInfo.importedSymbols.some(s => s.includes(term));

            // Exported symbol boost (strongest signal - file DEFINES the symbol)
            if (matchesExported) {
              symbolAwareScore += boostConfig.exported_symbol_boost;
            }
            // Defined symbol boost (class/function declarations)
            else if (matchesDefined) {
              symbolAwareScore += boostConfig.defined_symbol_boost;
            }
            // All symbols boost (weaker signal)
            else if (symbolInfo.classNames.some(s => s.includes(term)) ||
                     symbolInfo.functionNames.some(s => s.includes(term))) {
              symbolAwareScore += boostConfig.all_symbol_boost;
            }

            // Import-only penalty (file only USES the symbol, doesn't define it)
            if (matchesImported && !matchesExported && !matchesDefined) {
              symbolAwareScore *= boostConfig.import_only_penalty;
            }
          }
        }

        return {
          ...result,
          score: symbolAwareScore
        };
      });

      // Sort by new scores and apply limit/offset
      rerankedResults.sort((a, b) => b.score - a.score);
      const finalResults = rerankedResults.slice(offset, offset + limit);

      this.logger.debug('Symbol-aware search completed', {
        query,
        baseResults: baseResults.length,
        rerankedResults: finalResults.length,
        topScore: finalResults[0]?.score || 0,
        symbolFilesFound: symbolMetadata.size
      });

      return finalResults;

    } catch (error) {
      this.logger.error('Symbol-aware search failed, falling back to regular search', { query, error });
      return this.search(query, limit, offset);
    }
  }

  /**
   * Get document count and statistics
   */
  getStatistics(): {
    totalDocuments: number;
    avgDocumentLength: number;
    databaseSize: number;
    lastIndexed: Date | null;
  } {
    try {
      const countResult = this.db.prepare('SELECT COUNT(*) as count FROM bm25_documents').get() as { count: number };
      const avgLengthResult = this.db.prepare('SELECT AVG(doc_length) as avg_length FROM document_metadata').get() as { avg_length: number };
      const lastIndexedResult = this.db.prepare('SELECT MAX(created_at) as last_indexed FROM document_metadata').get() as { last_indexed: number };

      const stats = fs.statSync(this.config.database_path);

      return {
        totalDocuments: countResult.count,
        avgDocumentLength: Math.round(avgLengthResult.avg_length || 0),
        databaseSize: stats.size,
        lastIndexed: lastIndexedResult.last_indexed ? new Date(lastIndexedResult.last_indexed * 1000) : null
      };

    } catch (error) {
      this.logger.error('Failed to get statistics', { error });
      return {
        totalDocuments: 0,
        avgDocumentLength: 0,
        databaseSize: 0,
        lastIndexed: null
      };
    }
  }

  /**
   * Delete documents by IDs
   */
  async deleteDocuments(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    try {
      const deleteFTS = this.db.prepare('DELETE FROM bm25_documents WHERE id = ?');
      const deleteMeta = this.db.prepare('DELETE FROM document_metadata WHERE id = ?');

      const transaction = this.db.transaction(() => {
        for (const id of ids) {
          deleteFTS.run(id);
          deleteMeta.run(id);
        }
      });

      transaction();

      this.logger.info('Documents deleted', { count: ids.length });

    } catch (error) {
      this.logger.error('Failed to delete documents', { count: ids.length, error });
      throw error;
    }
  }

  /**
   * Clear all documents
   */
  async clearIndex(): Promise<void> {
    try {
      this.db.exec('DELETE FROM bm25_documents');
      this.db.exec('DELETE FROM document_metadata');
      this.db.exec('VACUUM');

      this.logger.info('BM25 index cleared');

    } catch (error) {
      this.logger.error('Failed to clear index', { error });
      throw error;
    }
  }

  /**
   * Preprocess text for better indexing (CODE-AWARE)
   *
   * Handles code-specific patterns:
   * - Splits camelCase/PascalCase: RealFileIndexingService → real file indexing service
   * - Splits underscores/hyphens: gpu_embedding → gpu embedding
   * - Preserves path structure: src/services/File.ts → src services file ts
   * - Handles dot notation: object.method → object method
   */
  private preprocessText(text: string): string {
    let processed = text;

    // 1. Split camelCase and PascalCase into separate words
    // First handle acronyms: XMLParser → XML Parser (uppercase followed by uppercase+lowercase)
    processed = processed.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

    // Then handle standard camelCase: EmbeddingService → Embedding Service
    processed = processed.replace(/([a-z])([A-Z])/g, '$1 $2');

    // Handle lowercase-to-number transitions: file2 → file 2
    processed = processed.replace(/([a-z])([0-9])/g, '$1 $2');

    // 2. Split on underscores and hyphens (common in code)
    // gpu_embedding_service → gpu embedding service
    // my-component → my component
    processed = processed.replace(/[_-]/g, ' ');

    // 3. Split on forward slashes (file paths)
    // src/services/File.ts → src services File ts
    processed = processed.replace(/\//g, ' ');

    // 4. Split on dots (method calls, file extensions)
    // object.method → object method
    // file.ts → file ts
    processed = processed.replace(/\./g, ' ');

    // 5. Remove remaining special chars (but words are already split)
    processed = processed.replace(/[^\w\s]/g, ' ');

    // 6. Normalize whitespace
    processed = processed.replace(/\s+/g, ' ');

    // 7. Lowercase and trim
    processed = processed.toLowerCase().trim();

    // 8. Limit document length
    const words = processed.split(/\s+/);
    if (words.length > this.config.max_terms_per_doc) {
      processed = words.slice(0, this.config.max_terms_per_doc).join(' ');
    }

    return processed;
  }

  /**
   * Preprocess search query (uses same code-aware logic as documents)
   */
  private preprocessQuery(query: string): string {
    // Use the same preprocessing as documents for consistent matching
    // This ensures "file indexing" matches "FileIndexing" in code
    return this.preprocessText(query);
  }

  /**
   * Get BM25 index statistics
   */
  async getIndexStats(): Promise<{
    totalDocuments: number;
    totalTerms: number;
    avgDocLength: number;
  }> {
    try {
      const totalDocs = this.db.prepare('SELECT COUNT(*) as count FROM documents').get() as { count: number };
      const totalTerms = this.db.prepare('SELECT COUNT(DISTINCT term) as count FROM terms').get() as { count: number };
      const avgLength = this.db.prepare('SELECT AVG(length) as avg FROM documents').get() as { avg: number };

      return {
        totalDocuments: totalDocs?.count || 0,
        totalTerms: totalTerms?.count || 0,
        avgDocLength: avgLength?.avg || 0
      };
    } catch (error) {
      this.logger.error('Failed to get index stats', error);
      return {
        totalDocuments: 0,
        totalTerms: 0,
        avgDocLength: 0
      };
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    try {
      this.db.close();
      this.logger.info('BM25 service closed');
    } catch (error) {
      this.logger.error('Error closing BM25 service', { error });
    }
  }
}