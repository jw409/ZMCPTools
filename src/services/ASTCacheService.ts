/**
 * AST Cache Service
 * SQLite-based cache for parsed AST data with timestamp-based invalidation
 * Uses Drizzle ORM following existing patterns from AnalysisStorageService
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { Logger } from '../utils/logger.js';
import { StoragePathResolver } from './StoragePathResolver.js';

const logger = new Logger('ast-cache');

export interface CachedASTData {
  filePath: string;
  fileHash: string;
  lastModified: Date;
  language: string;
  parseResult: any; // Full AST parse result
  symbols?: any[];
  imports?: string[];
  exports?: string[];
  structure?: string;
  cachedAt: Date;
}

export interface CacheStats {
  totalEntries: number;
  hitRate: number;
  avgParseTime: number;
  cacheSize: number;
  languages: Record<string, number>;
}

/**
 * AST Cache Service with timestamp-based invalidation
 * Follows the same pattern as AnalysisStorageService file_hashes table
 */
export class ASTCacheService {
  private db: Database.Database | null = null;
  private drizzleDb: any = null;
  private dbPath: string | null = null;
  private hits = 0;
  private misses = 0;

  /**
   * Initialize cache database at project root or specified path
   * Respects dom0/domU isolation:
   * - domU (project-local): var/storage/sqlite/ast_cache.db in project
   * - dom0 (system-wide): ~/dev/game1/var/storage/sqlite/ast_cache.db
   */
  async initialize(projectPath: string = process.cwd()): Promise<void> {
    // Use StoragePathResolver to get consistent storage location
    // preferLocal=true means we prefer project-local (domU) if var/ directory exists
    const storageConfig = StoragePathResolver.getStorageConfig({
      preferLocal: true,
      projectPath
    });
    StoragePathResolver.ensureStorageDirectories(storageConfig);

    this.dbPath = StoragePathResolver.getSQLitePath(storageConfig, 'ast_cache');

    logger.info('Initializing AST cache', {
      dbPath: this.dbPath,
      scope: storageConfig.scope,
      projectPath
    });

    // Ensure directory exists
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });

    // Create database connection
    this.db = new Database(this.dbPath);

    // Configure for optimal performance (same as AnalysisStorageService)
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 10000');
    this.db.pragma('temp_store = memory');
    this.db.pragma('mmap_size = 268435456'); // 256MB

    // Initialize Drizzle
    this.drizzleDb = drizzle(this.db);

    // Create schema
    await this.initializeSchema();

    logger.info('AST cache initialized successfully');
  }

  /**
   * Initialize database schema
   * Follows file_hashes pattern from AnalysisStorageService
   */
  private async initializeSchema(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const schema = `
      -- AST cache table with timestamp-based invalidation
      CREATE TABLE IF NOT EXISTS ast_cache (
        file_path TEXT PRIMARY KEY,
        file_hash TEXT NOT NULL,
        last_modified TEXT NOT NULL,  -- ISO timestamp
        language TEXT NOT NULL,
        parse_result TEXT NOT NULL,   -- JSON serialized AST
        symbols TEXT,                 -- JSON array of symbols
        imports TEXT,                 -- JSON array of imports
        exports TEXT,                 -- JSON array of exports
        structure TEXT,               -- Markdown structure outline
        cached_at TEXT NOT NULL,      -- ISO timestamp
        parse_time_ms INTEGER,        -- Time taken to parse (for stats)
        file_size INTEGER,            -- Original file size
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Index for quick lookups by file path
      CREATE INDEX IF NOT EXISTS idx_ast_cache_file_path ON ast_cache(file_path);

      -- Index for cache invalidation queries
      CREATE INDEX IF NOT EXISTS idx_ast_cache_last_modified ON ast_cache(last_modified);

      -- Index for statistics and cleanup
      CREATE INDEX IF NOT EXISTS idx_ast_cache_language ON ast_cache(language);
      CREATE INDEX IF NOT EXISTS idx_ast_cache_cached_at ON ast_cache(cached_at);

      -- Cache statistics table
      CREATE TABLE IF NOT EXISTS cache_stats (
        id INTEGER PRIMARY KEY,
        period TEXT NOT NULL,         -- 'hourly', 'daily', 'total'
        period_start TEXT NOT NULL,   -- ISO timestamp
        hits INTEGER DEFAULT 0,
        misses INTEGER DEFAULT 0,
        evictions INTEGER DEFAULT 0,
        avg_parse_time_ms REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(period, period_start)
      );
    `;

    this.db.exec(schema);
    logger.info('AST cache schema initialized');
  }

  /**
   * Get cached AST data if valid (timestamp-based invalidation)
   * Returns null if cache miss or stale
   */
  async get(filePath: string): Promise<CachedASTData | null> {
    if (!this.db) {
      await this.initialize();
    }

    try {
      // Get file stats for timestamp comparison
      const stats = await fs.stat(filePath);
      const currentMtime = stats.mtime;

      // Calculate file hash for content-based invalidation
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const currentHash = this.hashContent(fileContent);

      // Query cache
      const row = this.db!.prepare(`
        SELECT * FROM ast_cache WHERE file_path = ?
      `).get(filePath) as any;

      if (!row) {
        this.misses++;
        logger.debug('Cache miss', { filePath, reason: 'not_found' });
        return null;
      }

      // Check if cache is stale (mtime changed)
      const cachedMtime = new Date(row.last_modified);
      if (currentMtime > cachedMtime) {
        this.misses++;
        logger.debug('Cache miss', { filePath, reason: 'mtime_changed' });
        return null;
      }

      // Check if content hash changed (belt and suspenders)
      if (row.file_hash !== currentHash) {
        this.misses++;
        logger.debug('Cache miss', { filePath, reason: 'hash_changed' });
        return null;
      }

      // Cache hit!
      this.hits++;
      logger.debug('Cache hit', { filePath });

      return {
        filePath: row.file_path,
        fileHash: row.file_hash,
        lastModified: new Date(row.last_modified),
        language: row.language,
        parseResult: JSON.parse(row.parse_result),
        symbols: row.symbols ? JSON.parse(row.symbols) : undefined,
        imports: row.imports ? JSON.parse(row.imports) : undefined,
        exports: row.exports ? JSON.parse(row.exports) : undefined,
        structure: row.structure || undefined,
        cachedAt: new Date(row.cached_at)
      };

    } catch (error: any) {
      logger.warn('Cache lookup failed', { filePath, error: error.message });
      this.misses++;
      return null;
    }
  }

  /**
   * Store AST data in cache
   */
  async set(data: Omit<CachedASTData, 'cachedAt'>, parseTimeMs?: number): Promise<void> {
    if (!this.db) {
      await this.initialize();
    }

    try {
      const now = new Date().toISOString();

      // Get file size
      const stats = await fs.stat(data.filePath);

      this.db!.prepare(`
        INSERT OR REPLACE INTO ast_cache
        (file_path, file_hash, last_modified, language, parse_result, symbols, imports, exports, structure, cached_at, parse_time_ms, file_size)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.filePath,
        data.fileHash,
        data.lastModified.toISOString(),
        data.language,
        JSON.stringify(data.parseResult),
        data.symbols ? JSON.stringify(data.symbols) : null,
        data.imports ? JSON.stringify(data.imports) : null,
        data.exports ? JSON.stringify(data.exports) : null,
        data.structure || null,
        now,
        parseTimeMs || null,
        stats.size
      );

      logger.debug('Cache updated', { filePath: data.filePath, language: data.language });

    } catch (error: any) {
      logger.error('Failed to cache AST data', { filePath: data.filePath, error: error.message });
    }
  }

  /**
   * Calculate hash of file content
   */
  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Invalidate cache entry for a file
   */
  async invalidate(filePath: string): Promise<void> {
    if (!this.db) {
      await this.initialize();
    }

    this.db!.prepare('DELETE FROM ast_cache WHERE file_path = ?').run(filePath);
    logger.debug('Cache invalidated', { filePath });
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    if (!this.db) {
      await this.initialize();
    }

    this.db!.prepare('DELETE FROM ast_cache').run();
    logger.info('Cache cleared');
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    if (!this.db) {
      await this.initialize();
    }

    const totalEntries = this.db!.prepare('SELECT COUNT(*) as count FROM ast_cache').get() as { count: number };

    const languageStats = this.db!.prepare(`
      SELECT language, COUNT(*) as count FROM ast_cache GROUP BY language
    `).all() as Array<{ language: string; count: number }>;

    const languages: Record<string, number> = {};
    for (const stat of languageStats) {
      languages[stat.language] = stat.count;
    }

    const avgParseTime = this.db!.prepare(`
      SELECT AVG(parse_time_ms) as avg FROM ast_cache WHERE parse_time_ms IS NOT NULL
    `).get() as { avg: number | null };

    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? this.hits / totalRequests : 0;

    // Estimate cache size (approximate)
    const cacheSize = this.db!.prepare(`
      SELECT SUM(LENGTH(parse_result)) as size FROM ast_cache
    `).get() as { size: number | null };

    return {
      totalEntries: totalEntries.count,
      hitRate,
      avgParseTime: avgParseTime.avg || 0,
      cacheSize: cacheSize.size || 0,
      languages
    };
  }

  /**
   * Cleanup old cache entries (optional maintenance)
   */
  async cleanup(olderThanDays: number = 30): Promise<number> {
    if (!this.db) {
      await this.initialize();
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = this.db!.prepare(`
      DELETE FROM ast_cache WHERE cached_at < ?
    `).run(cutoffDate.toISOString());

    const deleted = result.changes;
    logger.info('Cache cleanup completed', { deleted, olderThanDays });

    return deleted;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.drizzleDb = null;
      logger.info('AST cache closed');
    }
  }
}

// Singleton instance
let cacheInstance: ASTCacheService | null = null;

/**
 * Get global cache instance
 */
export function getASTCache(): ASTCacheService {
  if (!cacheInstance) {
    cacheInstance = new ASTCacheService();
  }
  return cacheInstance;
}
