/**
 * SymbolGraphIndexer Service
 *
 * Intelligent code indexing using:
 * - Persistent storage with mtime + hash tracking (>95% cache hit rate)
 * - Separated search domains (BM25 code vs semantic intent)
 * - Import graph for cross-file relationships
 * - MCP resource caching integration
 *
 * Architecture:
 * - SQLite database: var/storage/sqlite/symbol_graph.db (project-local)
 * - Drizzle ORM following ASTCacheService pattern
 * - Incremental indexing: Only reindex changed files
 * - Search optimization: <5s on 17,402-file repos
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { sql, eq } from 'drizzle-orm';
import { glob } from 'glob';
import { TreeSitterASTTool } from '../tools/TreeSitterASTTool.js';
import { BM25Service } from './BM25Service.js';
import { EmbeddingClient } from './EmbeddingClient.js';
import { LanceDBService } from './LanceDBService.js';
import { Logger } from '../utils/logger.js';
import { StoragePathResolver } from './StoragePathResolver.js';
import { getPartitionClassifier, type PartitionInfo } from './PartitionClassifier.js';
import { SemanticChunker } from './SemanticChunker.js';


const logger = new Logger('symbol-graph-indexer');

// ============================================================================
// Types
// ============================================================================

export interface IndexedFileRecord {
  filePath: string;
  mtime: number;
  fileHash: string;
  language: string;
  size: number;
  symbolCount: number;
  lastIndexedAt: number;
  indexVersion: number;
  partitionId?: string;      // Knowledge partition (dom0, project, talent_*, etc.)
  authorityScore?: number;   // Authority level 0.0-1.0 (higher = more authoritative)
}

export interface SymbolRecord {
  id?: number;
  filePath: string;
  name: string;
  type: string;
  signature?: string;
  location: string;          // Compact format: "startLine:startCol-endLine:endCol"
  parentSymbol?: string;      // Parent class name for methods
  isExported: boolean;
}

export interface ImportRecord {
  id?: number;
  sourceFile: string;
  importPath: string;
  importedName?: string;
  isDefault: boolean;
}

export interface BM25DocumentRecord {
  filePath: string;
  searchableText: string;
  termCount: number;
}

export interface SemanticMetadataRecord {
  filePath: string;
  embeddingText: string;
  embeddingStored: boolean;
  lancedbId?: string;
}

export interface IndexStats {
  totalFiles: number;
  indexedFiles: number;      // Total files indexed (for compatibility with unifiedSearchTool.ts:227)
  alreadyIndexed: number;
  needsIndexing: number;
  skipped: number;
  errors: string[];
  indexingTimeMs?: number;
  languages?: Record<string, number>;
  totalSymbols?: number;     // Total symbols extracted (for IndexSymbolGraphTool reporting)
  filesWithEmbeddings?: number;  // Files with embeddings generated
}

export interface SearchResult {
  filePath: string;
  score: number;
  matchType: 'keyword' | 'semantic' | 'import';
  symbols?: SymbolRecord[];
  snippet?: string;
  metadata?: {
    originalScore?: number;
    authorityScore?: number;
    partition?: string;
    // Explicit degradation tracking (#60)
    degraded?: boolean;
    fallbackReason?: string;
    actualSearchMode?: 'semantic' | 'bm25' | 'hybrid';
  };
}

// ============================================================================
// SymbolGraphIndexer Service
// ============================================================================

export class SymbolGraphIndexer {
  private db: Database.Database | null = null;
  private drizzleDb: any = null;
  private dbPath: string | null = null;
  private astTool: TreeSitterASTTool;
  private bm25Service: BM25Service;
  private embeddingClient: EmbeddingClient;
  private lanceDBService: LanceDBService | null = null;
  private semanticChunker: SemanticChunker;
  private projectPath: string = '';
  private readonly COLLECTION_NAME = 'symbol_graph_embeddings';

  // File patterns to ignore (aligned with RealFileIndexingService)
  private ignorePatterns = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**',
    '**/*.min.js',
    '**/*.map',
    '**/package-lock.json',
    '**/yarn.lock',
    '**/.env*',
    '**/logs/**',
    '**/*.log'
  ];

  // Indexable extensions (aligned with RealFileIndexingService)
  // Phase 1: Added .md for full-text indexing
  private indexableExtensions = new Set([
    '.js', '.jsx', '.ts', '.tsx',
    '.py', '.pyi',
    '.java',
    '.cpp', '.cc', '.cxx', '.hpp', '.c', '.h',
    '.rs',
    '.php',
    '.html', '.htm',
    '.css', '.scss',
    '.md'  // Markdown files for FTS5 + semantic indexing
  ]);

  // Documentation file extensions (Phase 1: FTS5 indexing strategy)
  private docsExtensions = new Set([
    '.md', '.txt', '.rst', '.adoc'
  ]);

  constructor() {
    this.astTool = new TreeSitterASTTool();
    this.bm25Service = new BM25Service();
    this.embeddingClient = new EmbeddingClient();
    this.semanticChunker = new SemanticChunker({
      targetTokens: 28800,  // 90% of 32K for qwen3_4b
      overlapPercentage: 0.10,
      tokenLimit: 32000,
      model: 'qwen3_4b'
    });
  }

  /**
   * Detect if file is documentation (FTS5) or code (AST)
   * Phase 1: File type detection for dual-indexing strategy
   */
  private isDocumentationFile(filePath: string): boolean {
    const ext = path.extname(filePath);
    return this.docsExtensions.has(ext);
  }

  /**
   * Initialize database at project root (domU-aware)
   * Follows ASTCacheService pattern for storage location
   */
  async initialize(projectPath: string = process.cwd()): Promise<void> {
    // Use StoragePathResolver for consistent project-local storage
    const storageConfig = StoragePathResolver.getStorageConfig({
      preferLocal: true,
      projectPath
    });
    StoragePathResolver.ensureStorageDirectories(storageConfig);

    this.dbPath = StoragePathResolver.getSQLitePath(storageConfig, 'symbol_graph');

    logger.info('Initializing SymbolGraphIndexer', {
      dbPath: this.dbPath,
      scope: storageConfig.scope,
      projectPath
    });

    // Ensure directory exists
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });

    // Create database connection
    this.db = new Database(this.dbPath);

    // Configure for optimal performance (same as ASTCacheService)
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 10000');
    this.db.pragma('temp_store = memory');
    this.db.pragma('mmap_size = 268435456'); // 256MB

    // Initialize Drizzle
    this.drizzleDb = drizzle(this.db);

    // Create schema
    await this.initializeSchema();

    // Initialize LanceDB for semantic search
    this.projectPath = projectPath;
    this.lanceDBService = new LanceDBService(this.db as any, {
      projectPath,
      preferLocal: true,
      embeddingModel: 'qwen3_4b'  // Use Qwen3-Embedding-4B (2560D, +86% quality)
    });
    const lanceResult = await this.lanceDBService.initialize();
    if (!lanceResult.success) {
      logger.warn('LanceDB initialization failed, semantic search will be unavailable', {
        error: lanceResult.error
      });
    } else {
      logger.info('LanceDB initialized for semantic search');
    }

    logger.info('SymbolGraphIndexer initialized successfully');
  }

  /**
   * Migrate schema from old format (start_line/end_line) to new format (location/parent_symbol)
   */
  private async migrateSchemaIfNeeded(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      // Check if symbols table exists and has old schema
      const tableInfo = this.db.prepare(`PRAGMA table_info(symbols)`).all() as any[];

      if (tableInfo.length === 0) {
        // Table doesn't exist yet, no migration needed
        return;
      }

      const hasOldSchema = tableInfo.some(col => col.name === 'start_line' || col.name === 'end_line');
      const hasNewSchema = tableInfo.some(col => col.name === 'location');

      if (hasOldSchema && !hasNewSchema) {
        logger.info('Migrating SymbolGraphIndexer schema to hierarchical format...');

        // Backup old symbols data
        const oldSymbols = this.db.prepare('SELECT * FROM symbols').all();

        // Drop old table
        this.db.exec('DROP TABLE IF EXISTS symbols');

        // New schema will be created by initializeSchema
        logger.info(`Schema migration complete. Cleared ${oldSymbols.length} symbols for re-indexing.`);
      }
    } catch (error: any) {
      logger.warn('Schema migration check failed', { error: error.message });
    }
  }

  /**
   * Initialize database schema
   * Schema design from GitHub issue #45 + hierarchical symbol support
   */
  private async initializeSchema(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Check if we need to migrate from old schema
    await this.migrateSchemaIfNeeded();

    // The schema is now managed by Drizzle in `src/schemas`.
    // The `pnpm db:push` command handles schema creation and migration.
    // This method is kept for potential future manual migration logic.

    logger.info('SymbolGraphIndexer schema initialized');
  }

  /**
   * Check if file needs reindexing based on mtime + hash
   * Returns true if file is new or changed
   */
  async shouldReindex(filePath: string): Promise<boolean> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      // Get current file stats
      const stats = await fs.stat(filePath);
      const currentMtime = stats.mtime.getTime();

      // Query cached record
      const cached = this.db.prepare(`
        SELECT mtime, file_hash FROM indexed_files WHERE file_path = ?
      `).get(filePath) as { mtime: number; file_hash: string } | undefined;

      if (!cached) {
        return true; // Never indexed
      }

      // Quick check: mtime changed?
      if (cached.mtime !== currentMtime) {
        logger.debug('File mtime changed', { filePath: path.basename(filePath) });
        return true;
      }

      // Paranoid check: hash changed? (catches mtime edge cases)
      const content = await fs.readFile(filePath, 'utf-8');
      const currentHash = this.hashContent(content);

      if (cached.file_hash !== currentHash) {
        logger.debug('File hash changed', { filePath: path.basename(filePath) });
        return true;
      }

      return false; // Unchanged

    } catch (error: any) {
      logger.warn('Error checking file status', { filePath, error: error.message });
      return true; // Error = reindex
    }
  }

  /**
   * Extract code content for BM25 (symbols + imports only, NO comments)
   */
  private async extractCodeContent(filePath: string): Promise<string> {
    const parts: string[] = [];

    try {
      // Get symbols via TreeSitterASTTool
      const symbolsResult = await this.astTool.executeByToolName('ast_extract_symbols', {
        file_path: filePath,
        language: 'auto'
      });

      if (symbolsResult.success && symbolsResult.symbols) {
        for (const sym of symbolsResult.symbols) {
          parts.push(sym.name);
          if (sym.text) {
            parts.push(sym.text);
          }
        }
      }

      // Get imports
      const importsResult = await this.astTool.executeByToolName('ast_extract_imports', {
        file_path: filePath,
        language: 'auto'
      });

      if (importsResult.success && importsResult.imports) {
        for (const imp of importsResult.imports) {
          if (imp.source) parts.push(imp.source);
          if (imp.imported) parts.push(imp.imported);
        }
      }

    } catch (error: any) {
      logger.warn('Failed to extract code content', { filePath, error: error.message });
    }

    return parts.join(' ');
  }

  /**
   * Extract intent content for embeddings
   * Phase 1: Dual-indexing strategy
   * - Code files: docstrings + comments only (NO code)
   * - Markdown files: full text content
   */
  private async extractIntentContent(filePath: string): Promise<string> {
    const parts: string[] = [];

    try {
      const content = await fs.readFile(filePath, 'utf-8');

      // Phase 1: For markdown/docs, return full text
      if (this.isDocumentationFile(filePath)) {
        return content.trim();
      }

      // For code files: extract docstrings + comments only
      const lines = content.split('\n');

      // Extract JSDoc/docstrings (simple heuristic)
      const docstringPattern = /\/\*\*[\s\S]*?\*\/|"""[\s\S]*?"""|'''[\s\S]*?'''/g;
      const docstrings = content.match(docstringPattern) || [];
      parts.push(...docstrings);

      // Extract TODO/FIXME comments
      const todoPattern = /\/\/\s*(TODO|FIXME|NOTE|HACK):.*$/gm;
      const todos = content.match(todoPattern) || [];
      parts.push(...todos);

      // Extract top-level comments (first 10 lines)
      for (let i = 0; i < Math.min(10, lines.length); i++) {
        const line = lines[i].trim();
        if (line.startsWith('//') || line.startsWith('#')) {
          parts.push(line);
        }
      }

    } catch (error: any) {
      logger.warn('Failed to extract intent content', { filePath, error: error.message });
    }

    return parts.join('\n').trim();
  }

  /**
   * Calculate hash of file content
   */
  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Index a single file
   * Phase 1: Dual-indexing strategy (code via AST, markdown via FTS5)
   */
  private async indexFile(filePath: string, stats: IndexStats): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      // Check if needs reindexing
      const needsReindex = await this.shouldReindex(filePath);
      if (!needsReindex) {
        stats.alreadyIndexed++;
        return;
      }

      stats.needsIndexing++;

      // Get file metadata
      const fileStats = await fs.stat(filePath);
      const content = await fs.readFile(filePath, 'utf-8');
      const fileHash = this.hashContent(content);

      let language: string;
      let symbols: any[] = [];
      let imports: any[] = [];
      let exportedNames = new Set<string>();
      let codeContent = '';
      let intentContent = '';

      // Phase 1: Branch by file type (code vs docs)
      const isDoc = this.isDocumentationFile(filePath);

      if (isDoc) {
        // Documentation file: No AST extraction
        language = 'markdown';
        intentContent = content.trim(); // Full text for semantic search
        // codeContent remains empty (no BM25 indexing for docs)
      } else {
        // Code file: Full AST extraction
        // Parse symbols
        const parseResult = await this.astTool.executeByToolName('ast_extract_symbols', {
          file_path: filePath,
          language: 'auto'
        });

        if (!parseResult.success) {
          throw new Error(parseResult.error || 'Failed to parse file');
        }

        language = parseResult.language || 'unknown';
        symbols = parseResult.symbols || [];

        // Get imports
        const importsResult = await this.astTool.executeByToolName('ast_extract_imports', {
          file_path: filePath,
          language: 'auto'
        });

        imports = importsResult.success ? (importsResult.imports || []) : [];

        // Get exports to determine which symbols are exported
        const exportsResult = await this.astTool.executeByToolName('ast_extract_exports', {
          file_path: filePath,
          language: 'auto'
        });

        if (exportsResult.success && exportsResult.exports) {
          for (const exp of exportsResult.exports) {
            if (exp.name) exportedNames.add(exp.name);
          }
        }

        // Extract search content domains
        codeContent = await this.extractCodeContent(filePath);
        intentContent = await this.extractIntentContent(filePath);
      }

      // Classify file into knowledge partition (Phase 1)
      const partitionInfo = getPartitionClassifier().classify(filePath);
      logger.debug('Classified file', {
        filePath: path.basename(filePath),
        partition: partitionInfo.partition,
        authority: partitionInfo.authority
      });

      // Store in database (transaction for atomicity)
      const relativePath = path.relative(process.cwd(), filePath);

      this.db.transaction(() => {
        // 1. Update indexed_files (with partition metadata)
        this.db!.prepare(`
          INSERT OR REPLACE INTO indexed_files
          (file_path, mtime, file_hash, language, size, symbol_count, last_indexed_at, index_version, partition_id, authority_score)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          relativePath,
          fileStats.mtime.getTime(),
          fileHash,
          language,
          fileStats.size,
          symbols.length,
          Date.now(),
          1,
          partitionInfo.partition,
          partitionInfo.authority
        );

        // 2. Clear old symbols, imports, and FTS5 entries
        this.db!.prepare('DELETE FROM symbols WHERE file_path = ?').run(relativePath);
        this.db!.prepare('DELETE FROM imports WHERE source_file = ?').run(relativePath);
        this.db!.prepare('DELETE FROM fts5_documents WHERE file_path = ?').run(relativePath);
        this.db!.prepare('DELETE FROM semantic_chunks WHERE file_path = ?').run(relativePath);

        // 3. Insert symbols (flatten hierarchical structure)
        const symbolStmt = this.db!.prepare(`
          INSERT INTO symbols (file_path, name, type, signature, location, parent_symbol, is_exported)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        // Flatten hierarchical symbols while preserving parent-child relationships
        const flattenSymbols = (symList: any[], parentName: string | null = null) => {
          for (const sym of symList) {
            // Check if symbol is exported
            const isExported = exportedNames.has(sym.name) ? 1 : 0;

            // Use compact location if available, fallback to constructing from positions
            const location = sym.location ||
              (sym.startPosition && sym.endPosition
                ? `${sym.startPosition.row}:${sym.startPosition.column}-${sym.endPosition.row}:${sym.endPosition.column}`
                : '0:0-0:0');

            symbolStmt.run(
              relativePath,
              sym.name,
              sym.kind || 'unknown',
              sym.text || null,
              location,
              parentName,
              isExported
            );

            // Recursively flatten children (methods within classes)
            if (sym.children && sym.children.length > 0) {
              flattenSymbols(sym.children, sym.name);
            }
          }
        };

        flattenSymbols(symbols);

        // 4. Insert imports
        const importStmt = this.db!.prepare(`
          INSERT INTO imports (source_file, import_path, imported_name, is_default)
          VALUES (?, ?, ?, ?)
        `);

        for (const imp of imports) {
          importStmt.run(
            relativePath,
            imp.source || '',
            imp.imported || null,
            imp.isDefault ? 1 : 0
          );
        }

        // 5. Store BM25 document
        this.db!.prepare(`
          INSERT OR REPLACE INTO bm25_documents (file_path, searchable_text, term_count)
          VALUES (?, ?, ?)
        `).run(
          relativePath,
          codeContent,
          codeContent.split(' ').length
        );

        // 6. Store semantic metadata
        this.db!.prepare(`
          INSERT OR REPLACE INTO semantic_metadata (file_path, embedding_text, embedding_stored)
          VALUES (?, ?, ?)
        `).run(
          relativePath,
          intentContent,
          0 // embedding_stored - will be set when embedding generated
        );

        // 7. Phase 1: Store FTS5 document for markdown/docs
        if (isDoc && intentContent.length > 0) {
          this.db!.prepare(`
            INSERT INTO fts5_documents (file_path, content)
            VALUES (?, ?)
          `).run(
            relativePath,
            intentContent
          );
        }
      })();

      // Index in BM25 service
      await this.bm25Service.indexDocument({
        id: relativePath,
        text: codeContent,
        metadata: { language, symbolCount: symbols.length }
      });

      stats.indexedFiles++;
      logger.debug('File indexed', { filePath: relativePath, symbols: symbols.length });

    } catch (error: any) {
      stats.errors.push(`Failed to index ${filePath}: ${error.message}`);
      stats.skipped++;
      logger.warn('File indexing failed', { filePath, error: error.message });
    }
  }

  /**
   * Generate embeddings for files that don't have them yet
   * Uses smart chunking for large files (>28.8K tokens)
   * Processes files in batches to avoid overwhelming the GPU service
   */
  private async generatePendingEmbeddings(): Promise<void> {
    if (!this.lanceDBService || !this.db) {
      logger.error('LanceDB not initialized, skipping embedding generation.', {
        hasLanceDB: !!this.lanceDBService,
        hasDB: !!this.db
      });
      return;
    }

    const startTime = Date.now();
    logger.info('Starting pending embedding generation...');

    try {
      const pending = this.db.prepare(`
        SELECT
          sm.file_path,
          sm.embedding_text,
          if.partition_id,
          if.authority_score
        FROM semantic_metadata sm
        JOIN indexed_files if ON sm.file_path = if.file_path
        WHERE sm.embedding_stored = 0 AND length(sm.embedding_text) > 10
      `).all() as Array<{
        file_path: string;
        embedding_text: string;
        partition_id: string;
        authority_score: number;
      }>;

      if (pending.length === 0) {
        logger.info('No pending embeddings to generate.');
        return;
      }

      logger.info(`Found ${pending.length} files requiring embedding.`);

      let totalProcessedCount = 0;
      let totalFailedCount = 0;
      const BATCH_SIZE = 20; // As you suggested
      const totalBatches = Math.ceil(pending.length / BATCH_SIZE);

      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        const batch = pending.slice(i, i + BATCH_SIZE);
        const batchNumber = i / BATCH_SIZE + 1;
        logger.info(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} files)...`);

        try {
          // Step 1: Process chunks in parallel for the entire batch
          logger.debug(`Chunking ${batch.length} files in parallel...`);
          const chunkPromises = batch.map(row => {
            const language = this.isDocumentationFile(row.file_path) ? 'markdown' : 'typescript';
            return this.semanticChunker.chunkDocument(
              row.file_path,
              row.embedding_text,
              path.basename(row.file_path),
              language
            ).then(chunks => ({ row, chunks })); // Keep row and chunks associated
          });

          const results = await Promise.all(chunkPromises);
          logger.debug(`Chunked ${results.length} files`);

          // Step 2: Flatten all chunks from the batch and prepare for DB insertion
          logger.debug(`Preparing chunks for DB and GPU...`);
          const allDocuments: any[] = [];
          const dbTransaction = this.db.transaction(() => {
            // Clear existing chunks for this batch to prevent UNIQUE constraint errors
            const filePaths = batch.map(row => row.file_path);
            if (filePaths.length > 0) {
              const placeholders = filePaths.map(() => '?').join(',');
              this.db!.prepare(`DELETE FROM semantic_chunks WHERE file_path IN (${placeholders})`).run(...filePaths);
            }

            const insertChunkStmt = this.db!.prepare(`
              INSERT INTO semantic_chunks
              (chunk_id, file_path, chunk_index, chunk_text, start_offset, end_offset, token_count)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            
            for (const { row, chunks } of results) {
              if (chunks.length > 1) {
                logger.debug(`File ${path.basename(row.file_path)} was split into ${chunks.length} chunks.`);
              }

              for (const chunk of chunks) {
                // Store chunk metadata in SQLite
                insertChunkStmt.run(
                  chunk.metadata.chunkId,
                  row.file_path,
                  chunk.metadata.chunkIndex,
                  chunk.text,
                  chunk.metadata.startOffset,
                  chunk.metadata.endOffset,
                  chunk.metadata.tokenCount
                );

                // Prepare document for LanceDB batch insertion
                allDocuments.push({
                  id: chunk.metadata.chunkId,
                  content: chunk.text,
                  metadata: {
                    file_path: row.file_path,
                    chunk_index: chunk.metadata.chunkIndex,
                    total_chunks: chunks.length,
                    start_offset: chunk.metadata.startOffset,
                    end_offset: chunk.metadata.endOffset,
                    token_count: chunk.metadata.tokenCount,
                    indexed_at: new Date().toISOString(),
                    partition_id: row.partition_id,
                    authority_score: row.authority_score
                  }
                });
              }
            }
          });

          dbTransaction();
          logger.debug(`Prepared ${allDocuments.length} chunks for embedding`);

          // Step 3: Embed all documents in a single GPU call
          logger.debug(`Sending ${allDocuments.length} documents to GPU service...`);
          const gpuStartTime = Date.now();
          const embeddingResult = await this.lanceDBService.addDocuments(this.COLLECTION_NAME, allDocuments);
          const gpuDuration = Date.now() - gpuStartTime;
          logger.debug(`GPU processed ${allDocuments.length} docs in ${gpuDuration}ms`);

          // Step 4: Update database with success status
          if (embeddingResult.success) {
            logger.debug(`Updating DB with success status...`);
            const updateDbTransaction = this.db.transaction(() => {
                const updateMetaStmt = this.db!.prepare(`
                    UPDATE semantic_metadata SET embedding_stored = 1, total_chunks = (SELECT COUNT(*) FROM semantic_chunks WHERE file_path = ?) WHERE file_path = ?
                `);
                const updateChunkStatusStmt = this.db!.prepare(`
                    UPDATE semantic_chunks SET embedding_stored = 1, lancedb_id = ? WHERE chunk_id = ?
                `);

                const fileChunkCounts: Record<string, number> = {};
                for (const doc of allDocuments) {
                    updateChunkStatusStmt.run(doc.id, doc.id);
                    const filePath = doc.metadata.file_path;
                    if (!fileChunkCounts[filePath]) {
                        fileChunkCounts[filePath] = 0;
                    }
                    fileChunkCounts[filePath]++;
                }

                for (const filePath in fileChunkCounts) {
                    updateMetaStmt.run(filePath, filePath);
                }
            });

            updateDbTransaction();
            totalProcessedCount += batch.length;
            logger.info(`Batch ${batchNumber} completed successfully. Embedded ${allDocuments.length} documents.`);
          } else {
            totalFailedCount += batch.length;
            logger.error(`Failed to generate embeddings for batch ${batchNumber}.`, { error: embeddingResult.error });
            // Optionally, mark these files as failed to avoid retrying them immediately.
          }

        } catch (batchError: any) {
          totalFailedCount += batch.length;
          const filePaths = batch.map(r => r.file_path).join(', ');
          logger.error(`An unexpected error occurred processing batch ${batchNumber}.`, {
            error: batchError.message,
            files: filePaths,
            stack: batchError.stack,
          });
        }
      }

      const duration = (Date.now() - startTime) / 1000;
      logger.info('Embedding generation finished.', {
        totalFiles: pending.length,
        successfullyProcessed: totalProcessedCount,
        failed: totalFailedCount,
        durationSeconds: duration.toFixed(2),
        filesPerSecond: (totalProcessedCount / duration).toFixed(2),
      });

    } catch (error: any) {
      logger.error('A critical error occurred during the embedding generation process.', {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  /**
   * Find all indexable files in repository
   */
  private async findIndexableFiles(repoPath: string): Promise<string[]> {
    const patterns = Array.from(this.indexableExtensions).map(ext => `**/*${ext}`);
    let allFiles: string[] = [];

    for (const pattern of patterns) {
      const files = await glob(pattern, {
        cwd: repoPath,
        absolute: true,
        ignore: this.ignorePatterns,
        nodir: true
      });
      allFiles.push(...files);
    }

    // Remove duplicates and filter by size
    const uniqueFiles = [...new Set(allFiles)];
    const validFiles = [];

    for (const filePath of uniqueFiles) {
      try {
        const stats = await fs.stat(filePath);
        // Skip very large files (>1MB) and very small files (<10 bytes)
        if (stats.size > 10 && stats.size < 1024 * 1024) {
          validFiles.push(filePath);
        }
      } catch (error) {
        // Skip files that can't be accessed
      }
    }

    return validFiles;
  }

  async indexRepository(repoPath: string): Promise<IndexStats> {
    const startTime = Date.now();
    const stats: IndexStats = {
      totalFiles: 0,
      indexedFiles: 0,
      alreadyIndexed: 0,
      needsIndexing: 0,
      skipped: 0,
      errors: []
    };

    logger.info('Starting repository indexing', { repoPath });

    try {
      // Ensure database initialized
      if (!this.db) {
        await this.initialize(repoPath);
      }

      // Find all indexable files
      const files = await this.findIndexableFiles(repoPath);
      stats.totalFiles = files.length;

      logger.info(`Found ${files.length} indexable files`);

      // Process files in batches
      const batchSize = 50;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);

        for (const filePath of batch) {
          await this.indexFile(filePath, stats);
        }

        if (i % (batchSize * 4) === 0) {
          logger.info(`Indexing progress: ${i}/${files.length} files`);
        }
      }

      // Generate embeddings for newly indexed files
      await this.generatePendingEmbeddings();

      stats.indexingTimeMs = Date.now() - startTime;
      stats.indexedFiles = stats.alreadyIndexed + stats.needsIndexing; // Total indexed (new + cached)

      // Get language statistics and symbol counts
      const languageStats = await this.getStats();
      stats.languages = languageStats.languages;
      stats.totalSymbols = languageStats.totalSymbols;
      stats.filesWithEmbeddings = languageStats.filesWithEmbeddings;

      logger.info('Repository indexing completed', {
        totalFiles: stats.totalFiles,
        indexedFiles: stats.indexedFiles,
        alreadyIndexed: stats.alreadyIndexed,
        needsIndexing: stats.needsIndexing,
        cacheHitRate: `${((stats.alreadyIndexed / stats.totalFiles) * 100).toFixed(1)}%`,
        timeMs: stats.indexingTimeMs
      });

      return stats;

    } catch (error: any) {
      stats.errors.push(`Indexing failed: ${error.message}`);
      stats.indexingTimeMs = Date.now() - startTime;
      throw error;
    }
  }

  /**
   * Search using BM25 keyword search (code domain)
   * Phase 1: Authority-weighted results (dom0 ranks higher than project)
   */
  async searchKeyword(query: string, limit: number = 10): Promise<SearchResult[]> {
    // Get more results initially to allow for authority re-ranking
    const bm25Results = await this.bm25Service.search(query, limit * 3);

    const results = bm25Results.map(doc => {
      // Get symbols for this file
      const symbols = this.db!.prepare(`
        SELECT * FROM symbols WHERE file_path = ?
      `).all(doc.id) as SymbolRecord[];

      // Get partition metadata for authority weighting
      const fileInfo = this.db!.prepare(`
        SELECT partition_id, authority_score FROM indexed_files WHERE file_path = ?
      `).get(doc.id) as { partition_id: string; authority_score: number } | undefined;

      const authorityScore = fileInfo?.authority_score || 0.35; // Default to project authority
      const weightedScore = doc.score * authorityScore;

      return {
        filePath: doc.id,
        score: weightedScore,
        matchType: 'keyword' as const,
        symbols,
        // Store original score and authority for debugging
        metadata: {
          originalScore: doc.score,
          authorityScore,
          partition: fileInfo?.partition_id || 'unknown'
        }
      };
    });

    // Sort by weighted score and return top N
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Search using semantic embeddings (intent domain)
   * Phase 1: Authority-weighted results (dom0 ranks higher than project)
   * Uses LanceDB vector search to find semantically similar files
   *
   * Gracefully degrades to BM25 keyword search with explicit degradation tracking (#60)
   */
  async searchSemantic(query: string, limit: number = 10): Promise<SearchResult[]> {
    if (!this.lanceDBService || !this.db) {
      logger.warn('LanceDB not initialized, falling back to keyword search');
      const fallbackResults = await this.searchKeyword(query, limit);

      // Mark results as degraded - DON'T LIE about matchType
      return fallbackResults.map(result => ({
        ...result,
        matchType: 'keyword',  // TRUTH: It's keyword search, not semantic
        metadata: {
          ...result.metadata,
          degraded: true,
          fallbackReason: 'LanceDB not initialized - check GPU service at port 8765',
          actualSearchMode: 'bm25'
        }
      }));
    }

    try {
      // Search LanceDB using vector similarity (get more results for re-ranking)
      const results = await this.lanceDBService.searchSimilar(
        this.COLLECTION_NAME,
        query,
        limit * 3,
        0.3  // threshold - return results with >30% similarity
      );

      // Map to SearchResult format with authority weighting
      const searchResults = results.map(result => {
        // DEBUG: Log raw LanceDB metadata
        logger.debug('LanceDB result metadata', {
          metadata: result.metadata,
          hasFilePath: !!result.metadata.file_path,
          metadataType: typeof result.metadata,
          metadataKeys: Object.keys(result.metadata || {})
        });

        // Get symbols for this file
        const symbols = this.db!.prepare(`
          SELECT * FROM symbols WHERE file_path = ?
        `).all(result.metadata.file_path) as SymbolRecord[];

        // Authority score from LanceDB metadata (stored during indexing)
        const authorityScore = result.metadata.authority_score || 0.35;
        const weightedScore = result.score * authorityScore;

        return {
          filePath: result.metadata.file_path,
          score: weightedScore,
          matchType: 'semantic' as const,
          symbols,
          snippet: result.content.substring(0, 200),
          // Store original score and authority for debugging
          metadata: {
            ...result.metadata,  // ✅ Preserve ALL LanceDB metadata (fixes #52)
            originalScore: result.score,
            authorityScore,
            partition: result.metadata.partition_id || 'unknown',
            actualSearchMode: 'semantic'  // Explicit tracking
          }
        };
      });

      // Sort by weighted score and return top N
      searchResults.sort((a, b) => b.score - a.score);
      return searchResults.slice(0, limit);

    } catch (error: any) {
      logger.error('Semantic search failed, falling back to keyword search', {
        error: error.message
      });

      // Fallback to keyword search on error
      const keywordResults = await this.searchKeyword(query, limit);
      return keywordResults.map(result => ({
        ...result,
        matchType: 'keyword',  // TRUTH: It's keyword search, not semantic
        metadata: {
          ...result.metadata,
          degraded: true,
          fallbackReason: `Semantic search error: ${error.message}`,
          actualSearchMode: 'bm25'
        }
      }));
    }
  }

  /**
   * Build import graph for "find usages" queries
   */
  async buildImportGraph(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    logger.info('Building import graph...');

    // Import graph is already built during indexing
    // This method exists for explicit rebuilds if needed

    const importCount = this.db.prepare('SELECT COUNT(*) as count FROM imports').get() as { count: number };
    logger.info('Import graph complete', { totalImports: importCount.count });
  }

  /**
   * Search import graph (find what files use a module)
   */
  async searchImportGraph(modulePath: string, limit: number = 10): Promise<SearchResult[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const results = this.db.prepare(`
      SELECT source_file, import_path, COUNT(*) as import_count
      FROM imports
      WHERE import_path LIKE ?
      GROUP BY source_file
      ORDER BY import_count DESC
      LIMIT ?
    `).all(`%${modulePath}%`, limit) as Array<{ source_file: string; import_path: string; import_count: number }>;

    return results.map(row => ({
      filePath: row.source_file,
      score: row.import_count,
      matchType: 'import' as const,
      snippet: `Imports: ${row.import_path}`
    }));
  }

  /**
   * Get files that depend on a specific file (reverse dependencies)
   * Used for impact analysis: "what breaks if I change this file?"
   */
  async getFileDependents(filePath: string): Promise<string[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const results = this.db.prepare(`
      SELECT DISTINCT source_file
      FROM imports
      WHERE import_path LIKE ?
    `).all(`%${filePath}%`) as Array<{ source_file: string }>;

    return results.map(r => r.source_file);
  }

  /**
   * Get files that a specific file depends on (direct dependencies)
   */
  async getFileDependencies(filePath: string): Promise<string[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const results = this.db.prepare(`
      SELECT DISTINCT import_path
      FROM imports
      WHERE source_file = ?
    `).all(filePath) as Array<{ import_path: string }>;

    return results.map(r => r.import_path);
  }

  /**
   * Detect circular dependencies in the import graph
   * Returns cycles where A → B → ... → A
   */
  async detectCircularDependencies(): Promise<Array<{
    cycle: string[];
    depth: number;
  }>> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const cycles: Array<{ cycle: string[]; depth: number }> = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    // Get all files
    const allFiles = this.db.prepare(`
      SELECT DISTINCT file_path FROM indexed_files
    `).all() as Array<{ file_path: string }>;

    // DFS to detect cycles
    const detectCycle = (file: string, path: string[]): boolean => {
      if (recursionStack.has(file)) {
        // Found a cycle
        const cycleStart = path.indexOf(file);
        const cycle = path.slice(cycleStart).concat([file]);
        cycles.push({
          cycle,
          depth: cycle.length - 1
        });
        return true;
      }

      if (visited.has(file)) {
        return false;
      }

      visited.add(file);
      recursionStack.add(file);
      path.push(file);

      // Get dependencies
      const deps = this.db!.prepare(`
        SELECT DISTINCT import_path FROM imports WHERE source_file = ?
      `).all(file) as Array<{ import_path: string }>;

      for (const dep of deps) {
        // Only check local files (skip node_modules)
        if (!dep.import_path.includes('node_modules') && !dep.import_path.startsWith('@')) {
          detectCycle(dep.import_path, [...path]);
        }
      }

      recursionStack.delete(file);
      return false;
    };

    // Check each file
    for (const { file_path } of allFiles) {
      if (!visited.has(file_path)) {
        detectCycle(file_path, []);
      }
    }

    return cycles;
  }

  /**
   * Get impact analysis for a file
   * Returns all files that transitively depend on this file (recursive dependents)
   */
  async getImpactAnalysis(filePath: string, maxDepth: number = 5): Promise<Array<{
    filePath: string;
    depth: number;
    path: string[];
  }>> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const impacted: Array<{ filePath: string; depth: number; path: string[] }> = [];
    const visited = new Set<string>();

    const traverse = (file: string, depth: number, path: string[]) => {
      if (depth > maxDepth || visited.has(file)) {
        return;
      }

      visited.add(file);

      // Get files that import this file
      const dependents = this.db!.prepare(`
        SELECT DISTINCT source_file FROM imports WHERE import_path LIKE ?
      `).all(`%${file}%`) as Array<{ source_file: string }>;

      for (const dep of dependents) {
        impacted.push({
          filePath: dep.source_file,
          depth: depth + 1,
          path: [...path, dep.source_file]
        });

        // Recursively traverse
        traverse(dep.source_file, depth + 1, [...path, dep.source_file]);
      }
    };

    traverse(filePath, 0, [filePath]);

    return impacted;
  }

  /**
   * Get all indexed files with metadata (for symbols:// resource)
   */
  async getIndexedFiles(): Promise<Array<{
    file_path: string;
    indexed_at: string;
    symbol_count: number;
    has_embeddings: boolean;
  }>> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const results = this.db.prepare(`
      SELECT
        if.file_path,
        if.last_indexed_at,
        if.symbol_count,
        COALESCE(sm.embedding_stored, 0) as has_embeddings
      FROM indexed_files if
      LEFT JOIN semantic_metadata sm ON if.file_path = sm.file_path
      ORDER BY if.last_indexed_at DESC
    `).all() as Array<{
      file_path: string;
      last_indexed_at: number;
      symbol_count: number;
      has_embeddings: number;
    }>;

    return results.map(row => ({
      file_path: row.file_path,
      indexed_at: new Date(row.last_indexed_at).toISOString(),
      symbol_count: row.symbol_count || 0,
      has_embeddings: row.has_embeddings === 1
    }));
  }

  /**
   * Search symbols by name and optional type filter (for symbols:// resource)
   */
  async searchSymbols(name: string, type?: string, limit: number = 20): Promise<Array<{
    name: string;
    type: string;
    file_path: string;
    start_line: number;
    end_line: number;
    signature?: string;
  }>> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    let query = `
      SELECT name, type, file_path, location, signature
      FROM symbols
      WHERE name LIKE ?
    `;
    const params: any[] = [`%${name}%`];

    if (type) {
      query += ` AND type = ?`;
      params.push(type);
    }

    query += ` ORDER BY name LIMIT ?`;
    params.push(limit);

    const results = this.db.prepare(query).all(...params) as Array<{
      name: string;
      type: string;
      file_path: string;
      location: string;
      signature?: string;
    }>;

    return results.map(row => {
      // Parse location format: "startLine:startCol-endLine:endCol"
      const [start, end] = row.location.split('-');
      const [startLine, startCol] = start.split(':').map(Number);
      const [endLine, endCol] = end.split(':').map(Number);

      return {
        name: row.name,
        type: row.type,
        file_path: row.file_path,
        start_line: startLine,
        end_line: endLine,
        signature: row.signature
      };
    });
  }

  /**
   * Get symbols for a specific file from cache (for symbols:// resource)
   */
  async getFileSymbols(filePath: string): Promise<Array<{
    name: string;
    type: string;
    start_line: number;
    end_line: number;
    signature?: string;
  }>> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Normalize path to relative path
    const relativePath = path.relative(this.projectPath, filePath);

    const results = this.db.prepare(`
      SELECT name, type, location, signature
      FROM symbols
      WHERE file_path = ?
      ORDER BY location
    `).all(relativePath) as Array<{
      name: string;
      type: string;
      location: string;
      signature?: string;
    }>;

    return results.map(row => {
      // Parse location format: "startLine:startCol-endLine:endCol"
      const [start, end] = row.location.split('-');
      const [startLine, startCol] = start.split(':').map(Number);
      const [endLine, endCol] = end.split(':').map(Number);

      return {
        name: row.name,
        type: row.type,
        start_line: startLine,
        end_line: endLine,
        signature: row.signature
      };
    });
  }

  /**
   * Get file metadata from index (for symbols:// resource)
   */
  async getFileInfo(filePath: string): Promise<{
    indexed_at: string;
    has_embeddings: boolean;
  } | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Normalize path to relative path
    const relativePath = path.relative(this.projectPath, filePath);

    const result = this.db.prepare(`
      SELECT
        if.last_indexed_at,
        COALESCE(sm.embedding_stored, 0) as has_embeddings
      FROM indexed_files if
      LEFT JOIN semantic_metadata sm ON if.file_path = sm.file_path
      WHERE if.file_path = ?
    `).get(relativePath) as {
      last_indexed_at: number;
      has_embeddings: number;
    } | undefined;

    if (!result) {
      return null;
    }

    return {
      indexed_at: new Date(result.last_indexed_at).toISOString(),
      has_embeddings: result.has_embeddings === 1
    };
  }

  /**
   * Get statistics about indexed repository
   */
  async getStats(): Promise<{
    totalFiles: number;
    filesWithEmbeddings: number;
    totalSymbols: number;
    totalImports: number;
    languages: Record<string, number>;
    cacheHitRate: number;
    lastIndexed: string | null;
  }> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const totalFiles = (this.db.prepare('SELECT COUNT(*) as count FROM indexed_files').get() as { count: number }).count;
    const filesWithEmbeddings = (this.db.prepare('SELECT COUNT(*) as count FROM semantic_metadata WHERE embedding_stored = 1').get() as { count: number }).count;
    const totalSymbols = (this.db.prepare('SELECT COUNT(*) as count FROM symbols').get() as { count: number }).count;
    const totalImports = (this.db.prepare('SELECT COUNT(*) as count FROM imports').get() as { count: number }).count;

    const lastIndexedResult = this.db.prepare('SELECT MAX(last_indexed_at) as max_time FROM indexed_files').get() as { max_time: number | null };
    const lastIndexed = lastIndexedResult.max_time ? new Date(lastIndexedResult.max_time).toISOString() : null;

    const languageStats = this.db.prepare(`
      SELECT language, COUNT(*) as count FROM indexed_files GROUP BY language
    `).all() as Array<{ language: string; count: number }>;

    const languages: Record<string, number> = {};
    for (const stat of languageStats) {
      languages[stat.language] = stat.count;
    }

    return {
      totalFiles,
      filesWithEmbeddings,
      totalSymbols,
      totalImports,
      languages,
      cacheHitRate: 0, // Will be calculated during next indexing run
      lastIndexed
    };
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.drizzleDb = null;
      logger.info('SymbolGraphIndexer closed');
    }
  }

  /**
   * Clear all indexed data from the database
   */
  async clearIndex(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    logger.info('Clearing all indexed data from the database...');

    const tables = [
      'semantic_chunks',
      'semantic_metadata',
      'bm25_documents',
      'imports',
      'symbols',
      'fts5_documents',
      'indexed_files',
    ];

    this.db.transaction(() => {
      for (const table of tables) {
        try {
          // fts5_documents is a virtual table and needs a different delete syntax
          if (table === 'fts5_documents') {
            this.db!.prepare(`DELETE FROM ${table} WHERE 1=1;`).run();
          } else {
            this.db!.prepare(`DELETE FROM ${table};`).run();
          }
          logger.debug(`Cleared table: ${table}`);
        } catch (error: any) {
          // Ignore errors for tables that might not exist yet
          if (!error.message.includes('no such table')) {
            logger.warn(`Could not clear table: ${table}`, { error: error.message });
          }
        }
      }
    })();

    logger.info('All indexed data has been cleared.');
  }
}

// Singleton instance
let indexerInstance: SymbolGraphIndexer | null = null;

/**
 * Get global indexer instance
 */
export function getSymbolGraphIndexer(): SymbolGraphIndexer {
  if (!indexerInstance) {
    indexerInstance = new SymbolGraphIndexer();
  }
  return indexerInstance;
}
