/**
 * BM25 Sparse Embedding Service
 * Provides fast keyword-based search to complement dense embeddings
 * Uses SQLite FTS5 for persistence and fast text matching
 */

import { Logger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import Database from 'better-sqlite3';

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

  private readonly DEFAULT_CONFIG: BM25Config = {
    database_path: '',  // Will be set in constructor
    k1: 1.2,
    b: 0.75,
    min_term_length: 2,
    max_terms_per_doc: 1000
  };

  constructor(config?: Partial<BM25Config>) {
    this.logger = new Logger('bm25-service');
    this.mcptoolsDir = path.join(homedir(), '.mcptools');

    this.config = {
      ...this.DEFAULT_CONFIG,
      database_path: path.join(this.mcptoolsDir, 'bm25_index.db'),
      ...config
    };

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

      this.logger.info('BM25 database initialized', {
        path: this.config.database_path,
        config: this.config
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
      const searchQuery = `
        SELECT
          d.id,
          d.text,
          d.metadata,
          bm25(bm25_documents, ?, ?) as score
        FROM bm25_documents d
        WHERE bm25_documents MATCH ?
        ORDER BY score
        LIMIT ? OFFSET ?
      `;

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
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined
      }));

      this.logger.debug('BM25 search completed', {
        query: processedQuery,
        resultCount: results.length,
        topScore: results[0]?.score || 0
      });

      return results;

    } catch (error) {
      this.logger.error('BM25 search failed', { query, error });
      return [];
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
   * Preprocess text for better indexing
   */
  private preprocessText(text: string): string {
    // Remove excessive whitespace and normalize
    let processed = text
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .replace(/[^\w\s-]/g, ' ')  // Remove special chars except hyphens
      .toLowerCase()
      .trim();

    // Limit document length
    const words = processed.split(/\s+/);
    if (words.length > this.config.max_terms_per_doc) {
      processed = words.slice(0, this.config.max_terms_per_doc).join(' ');
    }

    return processed;
  }

  /**
   * Preprocess search query
   */
  private preprocessQuery(query: string): string {
    // Basic query preprocessing
    return query
      .replace(/[^\w\s-"]/g, ' ')  // Remove special chars except quotes and hyphens
      .replace(/\s+/g, ' ')
      .trim();
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