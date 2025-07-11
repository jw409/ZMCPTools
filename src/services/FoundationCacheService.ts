import { DatabaseManager } from '../database/index.js';
import { createHash, randomUUID } from 'crypto';
import { join, dirname, resolve } from 'path';
import { homedir } from 'os';
import { mkdirSync, existsSync, statSync } from 'fs';
import { readFile, access, stat, readdir } from 'fs/promises';
import Database from 'better-sqlite3';

export interface CacheEntry {
  id: string;
  content_hash: string;
  template_id: string;
  file_path: string;
  session_id: string;
  foundation_session_id?: string;
  result: any;
  tokens_used: number;
  tokens_saved: number;
  created_at: Date;
  last_accessed: Date;
  access_count: number;
  expires_at?: Date;
}

export interface FoundationSession {
  id: string;
  project_path: string;
  base_context: any;
  created_at: Date;
  last_used: Date;
  total_tokens_saved: number;
  cache_hits: number;
  cache_misses: number;
  derived_sessions: string[];
  project_hash: string;
  file_hashes: Record<string, string>;
  last_validated: Date;
}

export interface CacheStatistics {
  totalCacheEntries: number;
  foundationSessions: number;
  derivedSessions: number;
  totalTokensSaved: number;
  hitRate: number;
  avgTokensPerHit: number;
  recentHits: number;
  recentMisses: number;
  topTemplates: Array<{ templateId: string; hits: number; tokensSaved: number }>;
  cacheEfficiency: number;
}

export interface CacheConfig {
  maxCacheSize?: number;
  defaultTtlHours?: number;
  cleanupIntervalHours?: number;
  memoryLimitMB?: number;
  enableMetrics?: boolean;
  autoFoundationSessions?: boolean;
  projectHashValidityHours?: number;
}

export interface ProjectFileInfo {
  path: string;
  hash: string;
  lastModified: Date;
  size: number;
}

export interface ProjectMetadata {
  projectPath: string;
  projectHash: string;
  keyFiles: ProjectFileInfo[];
  lastAnalyzed: Date;
  gitCommitHash?: string;
}

export class FoundationCacheService {
  private db!: Database.Database;
  private memoryCache: Map<string, CacheEntry> = new Map();
  private sessionCache: Map<string, FoundationSession> = new Map();
  private config: Required<CacheConfig>;
  private lastCleanup: Date = new Date();

  constructor(private claudeDb: DatabaseManager, config: CacheConfig = {}) {
    this.config = {
      maxCacheSize: config.maxCacheSize ?? 10000,
      defaultTtlHours: config.defaultTtlHours ?? 24 * 7, // 7 days
      cleanupIntervalHours: config.cleanupIntervalHours ?? 6,
      memoryLimitMB: config.memoryLimitMB ?? 100,
      enableMetrics: config.enableMetrics ?? true,
      autoFoundationSessions: config.autoFoundationSessions ?? true,
      projectHashValidityHours: config.projectHashValidityHours ?? 24
    };

    this.initializeCacheDatabase();
    this.setupCleanupScheduler();
  }

  private initializeCacheDatabase(): void {
    const dbPath = join(homedir(), '.mcptools', 'data', 'foundation_cache.db');
    
    // Ensure directory exists
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(dbPath, {
      timeout: 30000,
    });

    // Initialize cache-specific pragmas for performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -32000'); // 32MB cache
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('foreign_keys = ON');

    this.createTables();
  }

  private createTables(): void {
    // Foundation Sessions table with enhanced project tracking
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS foundation_sessions (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        base_context TEXT NOT NULL, -- JSON
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        total_tokens_saved INTEGER NOT NULL DEFAULT 0,
        cache_hits INTEGER NOT NULL DEFAULT 0,
        cache_misses INTEGER NOT NULL DEFAULT 0,
        derived_sessions TEXT DEFAULT '[]' -- JSON array
      )
    `);

    // Migrate existing foundation_sessions table
    this.migrateFoundationSessionsTable();

    // Cache Entries table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache_entries (
        id TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        template_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        session_id TEXT NOT NULL,
        foundation_session_id TEXT,
        result TEXT NOT NULL, -- JSON
        tokens_used INTEGER NOT NULL DEFAULT 0,
        tokens_saved INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_accessed DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        access_count INTEGER NOT NULL DEFAULT 0,
        expires_at DATETIME,
        FOREIGN KEY (foundation_session_id) REFERENCES foundation_sessions(id)
      )
    `);

    // Indexes for performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cache_content_hash ON cache_entries(content_hash);
      CREATE INDEX IF NOT EXISTS idx_cache_template_session ON cache_entries(template_id, session_id);
      CREATE INDEX IF NOT EXISTS idx_cache_foundation_session ON cache_entries(foundation_session_id);
      CREATE INDEX IF NOT EXISTS idx_cache_expires_at ON cache_entries(expires_at);
      CREATE INDEX IF NOT EXISTS idx_foundation_project_path ON foundation_sessions(project_path);
      CREATE INDEX IF NOT EXISTS idx_foundation_project_hash ON foundation_sessions(project_hash);
      CREATE INDEX IF NOT EXISTS idx_foundation_last_validated ON foundation_sessions(last_validated);
    `);

    // Project metadata table for enhanced tracking
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_metadata (
        project_path TEXT PRIMARY KEY,
        project_hash TEXT NOT NULL,
        key_files TEXT NOT NULL, -- JSON array of ProjectFileInfo
        last_analyzed DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        git_commit_hash TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_project_metadata_hash ON project_metadata(project_hash);
      CREATE INDEX IF NOT EXISTS idx_project_metadata_analyzed ON project_metadata(last_analyzed);
    `);
  }

  private migrateFoundationSessionsTable(): void {
    // Check if new columns exist, add them if they don't
    const tableInfo = this.db.prepare('PRAGMA table_info(foundation_sessions)').all() as Array<{name: string}>;
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('project_hash')) {
      this.db.exec('ALTER TABLE foundation_sessions ADD COLUMN project_hash TEXT DEFAULT ""');
    }

    if (!columnNames.includes('file_hashes')) {
      this.db.exec('ALTER TABLE foundation_sessions ADD COLUMN file_hashes TEXT DEFAULT "{}"');
    }

    if (!columnNames.includes('last_validated')) {
      // SQLite doesn't allow CURRENT_TIMESTAMP as default in ALTER TABLE
      this.db.exec('ALTER TABLE foundation_sessions ADD COLUMN last_validated DATETIME');
      // Update existing rows with current timestamp
      this.db.exec('UPDATE foundation_sessions SET last_validated = CURRENT_TIMESTAMP WHERE last_validated IS NULL');
    }

    // Cache statistics table for metrics
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric_type TEXT NOT NULL,
        metric_key TEXT NOT NULL,
        metric_value REAL NOT NULL,
        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_metrics_type_key ON cache_metrics(metric_type, metric_key);
      CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON cache_metrics(timestamp);
    `);
  }

  /**
   * Automatically gets or creates a foundation session for a project
   * This is the main entry point for automatic foundation caching
   */
  async getOrCreateFoundationSession(projectPath: string, baseContext?: any): Promise<string> {
    if (!this.config.autoFoundationSessions) {
      throw new Error('Automatic foundation sessions are disabled');
    }

    const resolvedPath = resolve(projectPath);
    const projectHash = await this.calculateProjectHash(resolvedPath);
    
    // Check if we have a valid existing session
    const existingSession = await this.findValidFoundationSession(resolvedPath, projectHash);
    if (existingSession) {
      await this.updateSessionLastUsed(existingSession.id);
      return existingSession.id;
    }

    // Create new foundation session
    const sessionId = this.generateSessionId();
    const fileHashes = await this.calculateFileHashes(resolvedPath);
    const enhancedBaseContext = baseContext || await this.generateDefaultProjectContext(resolvedPath);
    
    const session: FoundationSession = {
      id: sessionId,
      project_path: resolvedPath,
      base_context: enhancedBaseContext,
      created_at: new Date(),
      last_used: new Date(),
      total_tokens_saved: 0,
      cache_hits: 0,
      cache_misses: 0,
      derived_sessions: [],
      project_hash: projectHash,
      file_hashes: fileHashes,
      last_validated: new Date()
    };

    await this.insertFoundationSession(session);
    await this.updateProjectMetadata(resolvedPath, projectHash, fileHashes);

    if (this.config.enableMetrics) {
      this.recordMetric('auto_session_created', sessionId, 1);
    }

    return sessionId;
  }

  /**
   * Creates a new foundation session for a project (legacy method)
   */
  async createFoundationSession(
    projectPath: string, 
    baseContext: any, 
    sessionId?: string
  ): Promise<string> {
    const id = sessionId || this.generateSessionId();
    const resolvedPath = resolve(projectPath);
    const projectHash = await this.calculateProjectHash(resolvedPath);
    const fileHashes = await this.calculateFileHashes(resolvedPath);
    
    const session: FoundationSession = {
      id,
      project_path: resolvedPath,
      base_context: baseContext,
      created_at: new Date(),
      last_used: new Date(),
      total_tokens_saved: 0,
      cache_hits: 0,
      cache_misses: 0,
      derived_sessions: [],
      project_hash: projectHash,
      file_hashes: fileHashes,
      last_validated: new Date()
    };

    await this.insertFoundationSession(session);
    await this.updateProjectMetadata(resolvedPath, projectHash, fileHashes);

    if (this.config.enableMetrics) {
      this.recordMetric('session_created', id, 1);
    }

    return id;
  }

  /**
   * Creates a derived session that inherits from a foundation session
   */
  async deriveSessionFromFoundation(
    foundationSessionId: string, 
    derivedSessionId: string
  ): Promise<boolean> {
    const foundationSession = await this.getFoundationSession(foundationSessionId);
    if (!foundationSession) {
      return false;
    }

    // Update foundation session with new derived session
    foundationSession.derived_sessions.push(derivedSessionId);
    foundationSession.last_used = new Date();

    const stmt = this.db.prepare(`
      UPDATE foundation_sessions 
      SET derived_sessions = ?, last_used = ?
      WHERE id = ?
    `);

    stmt.run(
      JSON.stringify(foundationSession.derived_sessions),
      foundationSession.last_used.toISOString(),
      foundationSessionId
    );

    // Update memory cache
    this.sessionCache.set(foundationSessionId, foundationSession);

    if (this.config.enableMetrics) {
      this.recordMetric('session_derived', derivedSessionId, 1);
    }

    return true;
  }

  /**
   * Gets cached analysis result with automatic foundation session management
   */
  async getCachedAnalysis(
    filePath: string, 
    content: string, 
    templateId: string, 
    sessionId?: string
  ): Promise<any | null> {
    const contentHash = this.generateContentHash(content, templateId);
    
    // If auto foundation sessions are enabled and no session provided, try to get/create one
    let effectiveSessionId = sessionId;
    if (this.config.autoFoundationSessions && !sessionId) {
      try {
        const projectPath = this.findProjectRoot(filePath);
        effectiveSessionId = await this.getOrCreateFoundationSession(projectPath);
      } catch (error) {
        // If we can't determine project path, continue without foundation session
        if (this.config.enableMetrics) {
          this.recordMetric('auto_session_failed', 'path_detection', 1);
        }
      }
    }
    
    // Try memory cache first
    const memoryCacheKey = `${contentHash}_${templateId}_${effectiveSessionId || 'default'}`;
    const memoryEntry = this.memoryCache.get(memoryCacheKey);
    
    if (memoryEntry && !this.isExpired(memoryEntry)) {
      this.updateAccessMetrics(memoryEntry);
      if (this.config.enableMetrics) {
        this.recordMetric('cache_hit', 'memory', 1);
      }
      return memoryEntry.result;
    }

    // Try database cache
    const dbEntry = this.findCacheEntry(contentHash, templateId, effectiveSessionId);
    
    if (dbEntry && !this.isExpired(dbEntry)) {
      // Load into memory cache
      this.memoryCache.set(memoryCacheKey, dbEntry);
      this.updateAccessMetrics(dbEntry);
      
      if (this.config.enableMetrics) {
        this.recordMetric('cache_hit', 'database', 1);
      }
      
      return dbEntry.result;
    }

    // Check foundation session for inherited cache
    if (effectiveSessionId) {
      const foundationEntry = await this.findInFoundationCache(contentHash, templateId, effectiveSessionId);
      if (foundationEntry && !this.isExpired(foundationEntry)) {
        // Load into memory cache
        this.memoryCache.set(memoryCacheKey, foundationEntry);
        this.updateAccessMetrics(foundationEntry);
        
        if (this.config.enableMetrics) {
          this.recordMetric('cache_hit', 'foundation', 1);
        }
        
        return foundationEntry.result;
      }
    }

    if (this.config.enableMetrics) {
      this.recordMetric('cache_miss', templateId, 1);
    }

    return null;
  }

  /**
   * Caches analysis result with automatic foundation session management
   */
  async cacheAnalysisResult(
    filePath: string, 
    content: string, 
    templateId: string, 
    result: any, 
    sessionId?: string, 
    tokensUsed: number = 0
  ): Promise<string> {
    const contentHash = this.generateContentHash(content, templateId);
    const entryId = this.generateCacheId();
    const expiresAt = new Date(Date.now() + (this.config.defaultTtlHours * 60 * 60 * 1000));
    
    // If auto foundation sessions are enabled and no session provided, try to get/create one
    let effectiveSessionId = sessionId;
    let foundationSessionId: string | undefined;
    
    if (this.config.autoFoundationSessions && !sessionId) {
      try {
        const projectPath = this.findProjectRoot(filePath);
        effectiveSessionId = await this.getOrCreateFoundationSession(projectPath);
        foundationSessionId = effectiveSessionId;
      } catch (error) {
        // If we can't determine project path, continue without foundation session
        if (this.config.enableMetrics) {
          this.recordMetric('auto_session_failed', 'cache_store', 1);
        }
      }
    } else if (sessionId) {
      foundationSessionId = await this.findFoundationSessionId(sessionId) || undefined;
    }
    
    // Estimate tokens saved (for subsequent identical requests)
    const tokensSaved = this.estimateTokensSaved(content, result);
    
    const entry: CacheEntry = {
      id: entryId,
      content_hash: contentHash,
      template_id: templateId,
      file_path: filePath,
      session_id: effectiveSessionId || 'default',
      foundation_session_id: foundationSessionId,
      result: result,
      tokens_used: tokensUsed,
      tokens_saved: tokensSaved,
      created_at: new Date(),
      last_accessed: new Date(),
      access_count: 0,
      expires_at: expiresAt
    };

    // Store in database
    const stmt = this.db.prepare(`
      INSERT INTO cache_entries 
      (id, content_hash, template_id, file_path, session_id, foundation_session_id, 
       result, tokens_used, tokens_saved, created_at, last_accessed, access_count, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id,
      entry.content_hash,
      entry.template_id,
      entry.file_path,
      entry.session_id,
      entry.foundation_session_id,
      JSON.stringify(entry.result),
      entry.tokens_used,
      entry.tokens_saved,
      entry.created_at.toISOString(),
      entry.last_accessed.toISOString(),
      entry.access_count,
      entry.expires_at?.toISOString()
    );

    // Store in memory cache
    const memoryCacheKey = `${contentHash}_${templateId}_${effectiveSessionId || 'default'}`;
    this.memoryCache.set(memoryCacheKey, entry);

    // Update foundation session metrics
    if (entry.foundation_session_id) {
      await this.updateFoundationSessionMetrics(entry.foundation_session_id, 0, 1);
    }

    if (this.config.enableMetrics) {
      this.recordMetric('cache_store', templateId, 1);
      this.recordMetric('tokens_saved_potential', templateId, tokensSaved);
    }

    // Cleanup if memory cache is getting too large
    this.cleanupMemoryCache();

    return entryId;
  }

  /**
   * Gets comprehensive cache statistics
   */
  async getCacheStatistics(): Promise<CacheStatistics> {
    const totalEntries = this.db.prepare('SELECT COUNT(*) as count FROM cache_entries').get() as { count: number };
    const totalSessions = this.db.prepare('SELECT COUNT(*) as count FROM foundation_sessions').get() as { count: number };
    
    // Calculate derived sessions
    const derivedSessionsResult = this.db.prepare(`
      SELECT SUM(JSON_ARRAY_LENGTH(derived_sessions)) as count 
      FROM foundation_sessions
    `).get() as { count: number | null };
    
    const derivedSessions = derivedSessionsResult.count || 0;

    // Calculate total tokens saved
    const tokensSavedResult = this.db.prepare(`
      SELECT SUM(tokens_saved * access_count) as total_saved,
             SUM(access_count) as total_hits,
             COUNT(*) as total_entries
      FROM cache_entries
    `).get() as { total_saved: number | null; total_hits: number | null; total_entries: number };

    const totalTokensSaved = tokensSavedResult.total_saved || 0;
    const totalHits = tokensSavedResult.total_hits || 0;
    const totalCacheEntries = tokensSavedResult.total_entries || 0;

    // Calculate hit rate (from metrics if available)
    const hitRate = this.calculateHitRate();

    // Average tokens per hit
    const avgTokensPerHit = totalHits > 0 ? totalTokensSaved / totalHits : 0;

    // Recent hits and misses (last 24 hours)
    const recentMetrics = this.getRecentMetrics();

    // Top templates by usage
    const topTemplates = this.getTopTemplates();

    // Cache efficiency (hits / (hits + misses))
    const cacheEfficiency = this.calculateCacheEfficiency();

    return {
      totalCacheEntries,
      foundationSessions: totalSessions.count,
      derivedSessions,
      totalTokensSaved,
      hitRate,
      avgTokensPerHit,
      recentHits: recentMetrics.hits,
      recentMisses: recentMetrics.misses,
      topTemplates,
      cacheEfficiency
    };
  }

  /**
   * Performs comprehensive cache cleanup and maintenance
   */
  async performMaintenance(): Promise<{
    expiredEntries: number;
    orphanedEntries: number;
    invalidSessions: number;
    staleProjectMetadata: number;
    compactedSize: number;
  }> {
    const now = new Date();
    
    // Remove expired entries
    const expiredStmt = this.db.prepare(`
      DELETE FROM cache_entries 
      WHERE expires_at IS NOT NULL AND expires_at < ?
    `);
    const expiredResult = expiredStmt.run(now.toISOString());

    // Remove orphaned entries (sessions that no longer exist)
    const orphanedStmt = this.db.prepare(`
      DELETE FROM cache_entries 
      WHERE foundation_session_id IS NOT NULL 
      AND foundation_session_id NOT IN (SELECT id FROM foundation_sessions)
    `);
    const orphanedResult = orphanedStmt.run();

    // Validate and remove invalid foundation sessions
    const invalidSessionsResult = await this.cleanupInvalidSessions();

    // Remove stale project metadata
    const staleMetadataResult = await this.cleanupStaleProjectMetadata();

    // Clean up old metrics (keep last 30 days)
    const oldMetricsDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    this.db.prepare(`
      DELETE FROM cache_metrics 
      WHERE timestamp < ?
    `).run(oldMetricsDate.toISOString());

    // Vacuum database for space reclamation
    const sizeBefore = this.db.prepare('PRAGMA page_count').get() as { page_count: number };
    this.db.exec('VACUUM');
    const sizeAfter = this.db.prepare('PRAGMA page_count').get() as { page_count: number };
    
    const compactedSize = (sizeBefore.page_count - sizeAfter.page_count) * 4096; // Assuming 4KB pages

    // Clean memory cache
    this.cleanupMemoryCache();

    this.lastCleanup = now;

    if (this.config.enableMetrics) {
      this.recordMetric('maintenance_expired_entries', 'cleanup', expiredResult.changes);
      this.recordMetric('maintenance_orphaned_entries', 'cleanup', orphanedResult.changes);
      this.recordMetric('maintenance_invalid_sessions', 'cleanup', invalidSessionsResult);
      this.recordMetric('maintenance_stale_metadata', 'cleanup', staleMetadataResult);
      this.recordMetric('maintenance_compacted_bytes', 'cleanup', compactedSize);
    }

    return {
      expiredEntries: expiredResult.changes,
      orphanedEntries: orphanedResult.changes,
      invalidSessions: invalidSessionsResult,
      staleProjectMetadata: staleMetadataResult,
      compactedSize
    };
  }

  /**
   * Clean up foundation sessions that are no longer valid
   */
  private async cleanupInvalidSessions(): Promise<number> {
    const stmt = this.db.prepare('SELECT id, project_path, project_hash FROM foundation_sessions');
    const sessions = stmt.all() as Array<{ id: string; project_path: string; project_hash: string }>;
    
    let cleanedCount = 0;
    
    for (const session of sessions) {
      try {
        // Check if project still exists
        await access(session.project_path);
        
        // Check if project hash is still valid
        const currentHash = await this.calculateProjectHash(session.project_path);
        if (currentHash !== session.project_hash) {
          // Project has changed significantly, remove session
          await this.removeFoundationSession(session.id);
          cleanedCount++;
        }
      } catch {
        // Project no longer exists, remove session
        await this.removeFoundationSession(session.id);
        cleanedCount++;
      }
    }
    
    return cleanedCount;
  }

  /**
   * Clean up stale project metadata
   */
  private async cleanupStaleProjectMetadata(): Promise<number> {
    const staleThreshold = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)); // 7 days
    
    const stmt = this.db.prepare(`
      SELECT project_path FROM project_metadata 
      WHERE last_analyzed < ?
    `);
    const staleProjects = stmt.all(staleThreshold.toISOString()) as Array<{ project_path: string }>;
    
    let cleanedCount = 0;
    
    for (const project of staleProjects) {
      try {
        // Check if project still exists
        await access(project.project_path);
        
        // Project exists but metadata is stale, could update it
        // For now, just leave it as maintenance will update it later
      } catch {
        // Project no longer exists, remove metadata
        await this.removeProjectMetadata(project.project_path);
        cleanedCount++;
      }
    }
    
    return cleanedCount;
  }

  /**
   * Validate all foundation sessions and return a health report
   */
  async validateFoundationSessions(): Promise<{
    total: number;
    valid: number;
    invalid: number;
    stale: number;
    details: Array<{
      sessionId: string;
      projectPath: string;
      status: 'valid' | 'invalid' | 'stale' | 'missing';
      reason?: string;
    }>;
  }> {
    const stmt = this.db.prepare('SELECT * FROM foundation_sessions');
    const sessions = stmt.all() as any[];
    
    const report = {
      total: sessions.length,
      valid: 0,
      invalid: 0,
      stale: 0,
      details: [] as Array<{
        sessionId: string;
        projectPath: string;
        status: 'valid' | 'invalid' | 'stale' | 'missing';
        reason?: string;
      }>
    };
    
    for (const row of sessions) {
      const session = this.rowToFoundationSession(row);
      const detail = {
        sessionId: session.id,
        projectPath: session.project_path,
        status: 'valid' as 'valid' | 'invalid' | 'stale' | 'missing',
        reason: undefined as string | undefined
      };
      
      try {
        // Check if project exists
        await access(session.project_path);
        
        // Check if session is still valid
        const isValid = await this.isFoundationSessionValid(session.id, session.project_path);
        
        if (isValid) {
          report.valid++;
        } else {
          // Check if it's just stale or actually invalid
          const currentHash = await this.calculateProjectHash(session.project_path);
          if (currentHash === session.project_hash) {
            detail.status = 'stale';
            detail.reason = 'Session validation expired but project unchanged';
            report.stale++;
          } else {
            detail.status = 'invalid';
            detail.reason = 'Project hash changed';
            report.invalid++;
          }
        }
      } catch {
        detail.status = 'missing';
        detail.reason = 'Project directory no longer exists';
        report.invalid++;
      }
      
      report.details.push(detail);
    }
    
    return report;
  }

  /**
   * Calculate project hash based on key files and structure with enhanced session key strategies
   */
  async calculateProjectHash(projectPath: string): Promise<string> {
    const keyFiles = await this.getKeyProjectFiles(projectPath);
    const fileHashes = await Promise.all(
      keyFiles.map(async (filePath) => {
        try {
          const content = await readFile(filePath, 'utf8');
          return createHash('sha256').update(content).digest('hex');
        } catch {
          return ''; // File might not exist
        }
      })
    );

    // Include git commit hash if available
    const gitHash = await this.getGitCommitHash(projectPath);
    
    // Include directory structure hash
    const structureHash = await this.calculateDirectoryStructureHash(projectPath);
    
    // Enhanced session key strategy: include semantic versioning
    const semanticVersion = await this.extractSemanticVersion(projectPath);
    
    // Include dependency fingerprint for better cache sharing
    const dependencyFingerprint = await this.calculateDependencyFingerprint(projectPath);
    
    // Include project type and framework fingerprint
    const projectFingerprint = await this.calculateProjectFingerprint(projectPath);
    
    const combinedHash = createHash('sha256')
      .update(keyFiles.join('|'))
      .update(fileHashes.join('|'))
      .update(gitHash || '')
      .update(structureHash)
      .update(semanticVersion)
      .update(dependencyFingerprint)
      .update(projectFingerprint)
      .digest('hex');

    return combinedHash;
  }

  /**
   * Calculate file hashes for key project files
   */
  async calculateFileHashes(projectPath: string): Promise<Record<string, string>> {
    const keyFiles = await this.getKeyProjectFiles(projectPath);
    const hashes: Record<string, string> = {};

    for (const filePath of keyFiles) {
      try {
        const content = await readFile(filePath, 'utf8');
        const relativePath = filePath.replace(projectPath, '').replace(/^[\/\\]/, '');
        hashes[relativePath] = createHash('sha256').update(content).digest('hex');
      } catch {
        // File might not exist, skip it
      }
    }

    return hashes;
  }

  /**
   * Check if a foundation session is still valid for a project
   */
  async isFoundationSessionValid(sessionId: string, projectPath: string): Promise<boolean> {
    const session = await this.getFoundationSession(sessionId);
    if (!session) return false;

    // Check if session belongs to the same project
    if (resolve(session.project_path) !== resolve(projectPath)) {
      return false;
    }

    // Check if validation is still fresh
    const validityThreshold = new Date(
      Date.now() - this.config.projectHashValidityHours * 60 * 60 * 1000
    );
    if (session.last_validated > validityThreshold) {
      return true;
    }

    // Re-validate by checking current project hash
    const currentProjectHash = await this.calculateProjectHash(projectPath);
    const isValid = currentProjectHash === session.project_hash;

    if (isValid) {
      // Update validation timestamp
      await this.updateSessionValidation(sessionId);
    }

    return isValid;
  }

  /**
   * Invalidate project cache when files change
   */
  async invalidateProjectCache(projectPath: string): Promise<void> {
    const resolvedPath = resolve(projectPath);
    
    // Find all foundation sessions for this project
    const sessions = await this.getFoundationSessionsByProject(resolvedPath);
    
    for (const session of sessions) {
      // Invalidate all cache entries for this foundation session
      await this.invalidateCache({ sessionId: session.id });
      
      // Remove the foundation session itself
      await this.removeFoundationSession(session.id);
    }

    // Remove project metadata
    await this.removeProjectMetadata(resolvedPath);

    if (this.config.enableMetrics) {
      this.recordMetric('project_cache_invalidated', resolvedPath, sessions.length);
    }
  }

  /**
   * Invalidates cache entries by various criteria
   */
  async invalidateCache(criteria: {
    sessionId?: string;
    templateId?: string;
    filePath?: string;
    olderThan?: Date;
  }): Promise<number> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (criteria.sessionId) {
      conditions.push('session_id = ?');
      params.push(criteria.sessionId);
    }

    if (criteria.templateId) {
      conditions.push('template_id = ?');
      params.push(criteria.templateId);
    }

    if (criteria.filePath) {
      conditions.push('file_path = ?');
      params.push(criteria.filePath);
    }

    if (criteria.olderThan) {
      conditions.push('created_at < ?');
      params.push(criteria.olderThan.toISOString());
    }

    if (conditions.length === 0) {
      throw new Error('At least one invalidation criteria must be provided');
    }

    const sql = `DELETE FROM cache_entries WHERE ${conditions.join(' AND ')}`;
    const result = this.db.prepare(sql).run(...params);

    // Also remove from memory cache
    for (const [key, entry] of this.memoryCache.entries()) {
      let shouldRemove = false;
      
      if (criteria.sessionId && entry.session_id === criteria.sessionId) shouldRemove = true;
      if (criteria.templateId && entry.template_id === criteria.templateId) shouldRemove = true;
      if (criteria.filePath && entry.file_path === criteria.filePath) shouldRemove = true;
      if (criteria.olderThan && entry.created_at < criteria.olderThan) shouldRemove = true;
      
      if (shouldRemove) {
        this.memoryCache.delete(key);
      }
    }

    if (this.config.enableMetrics) {
      this.recordMetric('cache_invalidated', 'manual', result.changes);
    }

    return result.changes;
  }

  // Private helper methods

  private async getKeyProjectFiles(projectPath: string): Promise<string[]> {
    const keyFileNames = [
      'package.json',
      'tsconfig.json',
      'CLAUDE.md',
      'README.md',
      'pyproject.toml',
      'requirements.txt',
      'Cargo.toml',
      'go.mod',
      'composer.json',
      'pom.xml',
      'build.gradle',
      '.gitignore',
      'Dockerfile',
      'docker-compose.yml'
    ];

    const foundFiles: string[] = [];
    
    for (const fileName of keyFileNames) {
      const filePath = join(projectPath, fileName);
      try {
        await access(filePath);
        foundFiles.push(filePath);
      } catch {
        // File doesn't exist, skip it
      }
    }

    return foundFiles;
  }

  private async getGitCommitHash(projectPath: string): Promise<string | null> {
    try {
      const gitHeadPath = join(projectPath, '.git', 'HEAD');
      const headContent = await readFile(gitHeadPath, 'utf8');
      
      if (headContent.startsWith('ref: ')) {
        // HEAD points to a branch
        const refPath = headContent.trim().substring(5);
        const gitRefPath = join(projectPath, '.git', refPath);
        const commitHash = await readFile(gitRefPath, 'utf8');
        return commitHash.trim();
      } else {
        // HEAD contains a commit hash directly
        return headContent.trim();
      }
    } catch {
      return null;
    }
  }

  private async calculateDirectoryStructureHash(projectPath: string): Promise<string> {
    try {
      const entries = await readdir(projectPath, { withFileTypes: true });
      const relevantEntries = entries
        .filter(entry => !this.shouldIgnoreForStructureHash(entry.name))
        .map(entry => `${entry.name}:${entry.isDirectory() ? 'dir' : 'file'}`)
        .sort();
      
      return createHash('sha256')
        .update(relevantEntries.join('|'))
        .digest('hex');
    } catch {
      return '';
    }
  }

  private shouldIgnoreForStructureHash(name: string): boolean {
    const ignorePatterns = [
      'node_modules',
      '.git',
      'dist',
      'build',
      'target',
      '__pycache__',
      '.next',
      '.nuxt',
      'coverage',
      '.DS_Store',
      'Thumbs.db',
      '*.log'
    ];
    
    return ignorePatterns.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(name);
      }
      return name === pattern;
    });
  }

  /**
   * Extract semantic version for better cache key generation
   */
  private async extractSemanticVersion(projectPath: string): Promise<string> {
    try {
      const packageJsonPath = join(projectPath, 'package.json');
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
      
      if (packageJson.version) {
        // Extract major.minor for cache sharing across patch versions
        const version = packageJson.version.split('.');
        return `${version[0]}.${version[1]}`;
      }
    } catch {
      // Try other version sources
      try {
        const pyprojectPath = join(projectPath, 'pyproject.toml');
        const pyprojectContent = await readFile(pyprojectPath, 'utf8');
        const versionMatch = pyprojectContent.match(/version\s*=\s*["']([^"']+)["']/);
        if (versionMatch) {
          const version = versionMatch[1].split('.');
          return `${version[0]}.${version[1]}`;
        }
      } catch {
        // Try Cargo.toml
        try {
          const cargoPath = join(projectPath, 'Cargo.toml');
          const cargoContent = await readFile(cargoPath, 'utf8');
          const versionMatch = cargoContent.match(/version\s*=\s*["']([^"']+)["']/);
          if (versionMatch) {
            const version = versionMatch[1].split('.');
            return `${version[0]}.${version[1]}`;
          }
        } catch {
          // No version found
        }
      }
    }
    
    return '0.0';
  }

  /**
   * Calculate dependency fingerprint for better cache sharing
   */
  private async calculateDependencyFingerprint(projectPath: string): Promise<string> {
    const dependencies: string[] = [];
    
    try {
      // Node.js dependencies
      const packageJsonPath = join(projectPath, 'package.json');
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
      
      if (packageJson.dependencies) {
        // Focus on major framework dependencies for fingerprinting
        const majorDeps = ['react', 'vue', 'angular', 'next', 'nuxt', 'express', 'fastify'];
        for (const dep of majorDeps) {
          if (packageJson.dependencies[dep]) {
            const version = packageJson.dependencies[dep].replace(/[^\d.]/g, '');
            const majorVersion = version.split('.')[0];
            dependencies.push(`${dep}@${majorVersion}`);
          }
        }
        
        // Add TypeScript if present
        if (packageJson.devDependencies?.typescript) {
          const version = packageJson.devDependencies.typescript.replace(/[^\d.]/g, '');
          const majorVersion = version.split('.')[0];
          dependencies.push(`typescript@${majorVersion}`);
        }
      }
    } catch {
      // Try Python dependencies
      try {
        const requirementsPath = join(projectPath, 'requirements.txt');
        const requirements = await readFile(requirementsPath, 'utf8');
        
        const majorPythonDeps = ['django', 'flask', 'fastapi', 'numpy', 'pandas', 'tensorflow', 'pytorch'];
        for (const line of requirements.split('\n')) {
          const dep = line.trim().split('==')[0].split('>=')[0].split('~=')[0];
          if (majorPythonDeps.includes(dep.toLowerCase())) {
            dependencies.push(dep.toLowerCase());
          }
        }
      } catch {
        // Try other dependency files
        try {
          const pyprojectPath = join(projectPath, 'pyproject.toml');
          const pyprojectContent = await readFile(pyprojectPath, 'utf8');
          // Simple extraction of dependencies from pyproject.toml
          const depsMatch = pyprojectContent.match(/dependencies\s*=\s*\[(.*?)\]/s);
          if (depsMatch) {
            const deps = depsMatch[1].split(',').map(d => d.trim().replace(/["']/g, ''));
            for (const dep of deps) {
              const depName = dep.split('>=')[0].split('==')[0].split('~=')[0].trim();
              if (depName) {
                dependencies.push(depName);
              }
            }
          }
        } catch {
          // No dependency file found
        }
      }
    }
    
    return dependencies.sort().join('|');
  }

  /**
   * Calculate project fingerprint for framework and tool identification
   */
  private async calculateProjectFingerprint(projectPath: string): Promise<string> {
    const fingerprint: string[] = [];
    
    // Check for framework indicators
    const frameworks = await this.detectFrameworks(projectPath);
    fingerprint.push(...frameworks);
    
    // Check for build tools
    const buildTools = await this.detectBuildTools(projectPath);
    fingerprint.push(...buildTools);
    
    // Check for testing frameworks
    const testFrameworks = await this.detectTestFrameworks(projectPath);
    fingerprint.push(...testFrameworks);
    
    // Check for linting/formatting tools
    const lintTools = await this.detectLintingTools(projectPath);
    fingerprint.push(...lintTools);
    
    return fingerprint.sort().join('|');
  }

  /**
   * Detect frameworks in the project
   */
  private async detectFrameworks(projectPath: string): Promise<string[]> {
    const frameworks: string[] = [];
    
    try {
      const packageJsonPath = join(projectPath, 'package.json');
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
      
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };
      
      // Frontend frameworks
      if (allDeps.react) frameworks.push('react');
      if (allDeps.vue) frameworks.push('vue');
      if (allDeps['@angular/core']) frameworks.push('angular');
      if (allDeps.next) frameworks.push('nextjs');
      if (allDeps.nuxt) frameworks.push('nuxt');
      if (allDeps.svelte) frameworks.push('svelte');
      
      // Backend frameworks
      if (allDeps.express) frameworks.push('express');
      if (allDeps.fastify) frameworks.push('fastify');
      if (allDeps.koa) frameworks.push('koa');
      if (allDeps.nest) frameworks.push('nestjs');
      
      // Build tools
      if (allDeps.vite) frameworks.push('vite');
      if (allDeps.webpack) frameworks.push('webpack');
      if (allDeps.rollup) frameworks.push('rollup');
      if (allDeps.parcel) frameworks.push('parcel');
      
    } catch {
      // Try other project types
      try {
        const pyprojectPath = join(projectPath, 'pyproject.toml');
        const pyprojectContent = await readFile(pyprojectPath, 'utf8');
        
        if (pyprojectContent.includes('django')) frameworks.push('django');
        if (pyprojectContent.includes('flask')) frameworks.push('flask');
        if (pyprojectContent.includes('fastapi')) frameworks.push('fastapi');
        if (pyprojectContent.includes('pytest')) frameworks.push('pytest');
        
      } catch {
        // Try Cargo.toml for Rust
        try {
          const cargoPath = join(projectPath, 'Cargo.toml');
          const cargoContent = await readFile(cargoPath, 'utf8');
          
          if (cargoContent.includes('actix-web')) frameworks.push('actix-web');
          if (cargoContent.includes('warp')) frameworks.push('warp');
          if (cargoContent.includes('rocket')) frameworks.push('rocket');
          if (cargoContent.includes('axum')) frameworks.push('axum');
          
        } catch {
          // No framework detected
        }
      }
    }
    
    return frameworks;
  }

  /**
   * Detect build tools in the project
   */
  private async detectBuildTools(projectPath: string): Promise<string[]> {
    const buildTools: string[] = [];
    
    // Check for build config files
    const buildConfigs = [
      { file: 'webpack.config.js', tool: 'webpack' },
      { file: 'webpack.config.ts', tool: 'webpack' },
      { file: 'vite.config.js', tool: 'vite' },
      { file: 'vite.config.ts', tool: 'vite' },
      { file: 'rollup.config.js', tool: 'rollup' },
      { file: 'rollup.config.ts', tool: 'rollup' },
      { file: 'esbuild.config.js', tool: 'esbuild' },
      { file: 'turbo.json', tool: 'turbo' },
      { file: 'nx.json', tool: 'nx' },
      { file: 'lerna.json', tool: 'lerna' },
      { file: 'rush.json', tool: 'rush' }
    ];
    
    for (const config of buildConfigs) {
      try {
        await stat(join(projectPath, config.file));
        buildTools.push(config.tool);
      } catch {
        // File doesn't exist
      }
    }
    
    return buildTools;
  }

  /**
   * Detect testing frameworks in the project
   */
  private async detectTestFrameworks(projectPath: string): Promise<string[]> {
    const testFrameworks: string[] = [];
    
    try {
      const packageJsonPath = join(projectPath, 'package.json');
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
      
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };
      
      if (allDeps.jest) testFrameworks.push('jest');
      if (allDeps.vitest) testFrameworks.push('vitest');
      if (allDeps.mocha) testFrameworks.push('mocha');
      if (allDeps.jasmine) testFrameworks.push('jasmine');
      if (allDeps.cypress) testFrameworks.push('cypress');
      if (allDeps.playwright) testFrameworks.push('playwright');
      if (allDeps['@testing-library/react']) testFrameworks.push('react-testing-library');
      if (allDeps['@testing-library/vue']) testFrameworks.push('vue-testing-library');
      
    } catch {
      // No package.json found
    }
    
    return testFrameworks;
  }

  /**
   * Detect linting and formatting tools
   */
  private async detectLintingTools(projectPath: string): Promise<string[]> {
    const lintTools: string[] = [];
    
    try {
      const packageJsonPath = join(projectPath, 'package.json');
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
      
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };
      
      if (allDeps.eslint) lintTools.push('eslint');
      if (allDeps.prettier) lintTools.push('prettier');
      if (allDeps.tslint) lintTools.push('tslint');
      if (allDeps.stylelint) lintTools.push('stylelint');
      if (allDeps.commitlint) lintTools.push('commitlint');
      
    } catch {
      // No package.json found
    }
    
    // Check for config files
    const lintConfigs = [
      { file: '.eslintrc.js', tool: 'eslint' },
      { file: '.eslintrc.json', tool: 'eslint' },
      { file: '.prettierrc', tool: 'prettier' },
      { file: '.stylelintrc', tool: 'stylelint' },
      { file: 'commitlint.config.js', tool: 'commitlint' }
    ];
    
    for (const config of lintConfigs) {
      try {
        await stat(join(projectPath, config.file));
        if (!lintTools.includes(config.tool)) {
          lintTools.push(config.tool);
        }
      } catch {
        // File doesn't exist
      }
    }
    
    return lintTools;
  }

  private async findValidFoundationSession(projectPath: string, projectHash: string): Promise<FoundationSession | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM foundation_sessions 
      WHERE project_path = ? AND project_hash = ?
      ORDER BY last_used DESC
      LIMIT 1
    `);

    const row = stmt.get(projectPath, projectHash) as any;
    if (!row) return null;

    const session = this.rowToFoundationSession(row);
    
    // Validate that the session is still current
    if (await this.isFoundationSessionValid(session.id, projectPath)) {
      return session;
    }

    return null;
  }

  private async generateDefaultProjectContext(projectPath: string): Promise<any> {
    const context: any = {
      projectPath: projectPath,
      analyzedAt: new Date().toISOString(),
      keyFiles: [],
      projectType: 'unknown',
      technologies: []
    };

    // Analyze key files
    const keyFiles = await this.getKeyProjectFiles(projectPath);
    context.keyFiles = keyFiles.map(f => f.replace(projectPath, '').replace(/^[\/\\]/, ''));

    // Detect project type and technologies
    if (keyFiles.some(f => f.endsWith('package.json'))) {
      context.projectType = 'node';
      context.technologies.push('Node.js');
      
      try {
        const packageJson = JSON.parse(await readFile(join(projectPath, 'package.json'), 'utf8'));
        if (packageJson.dependencies?.react) context.technologies.push('React');
        if (packageJson.dependencies?.vue) context.technologies.push('Vue');
        if (packageJson.dependencies?.['@angular/core']) context.technologies.push('Angular');
        if (packageJson.devDependencies?.typescript || keyFiles.some(f => f.endsWith('tsconfig.json'))) {
          context.technologies.push('TypeScript');
        }
      } catch {
        // Ignore package.json parsing errors
      }
    }

    if (keyFiles.some(f => f.endsWith('pyproject.toml') || f.endsWith('requirements.txt'))) {
      context.projectType = 'python';
      context.technologies.push('Python');
    }

    if (keyFiles.some(f => f.endsWith('Cargo.toml'))) {
      context.projectType = 'rust';
      context.technologies.push('Rust');
    }

    if (keyFiles.some(f => f.endsWith('go.mod'))) {
      context.projectType = 'go';
      context.technologies.push('Go');
    }

    return context;
  }

  private async insertFoundationSession(session: FoundationSession): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO foundation_sessions 
      (id, project_path, base_context, created_at, last_used, total_tokens_saved, 
       cache_hits, cache_misses, derived_sessions, project_hash, file_hashes, last_validated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.project_path,
      JSON.stringify(session.base_context),
      session.created_at.toISOString(),
      session.last_used.toISOString(),
      session.total_tokens_saved,
      session.cache_hits,
      session.cache_misses,
      JSON.stringify(session.derived_sessions),
      session.project_hash || '',
      JSON.stringify(session.file_hashes || {}),
      session.last_validated.toISOString()
    );

    // Cache in memory
    this.sessionCache.set(session.id, session);
  }

  private async updateProjectMetadata(projectPath: string, projectHash: string, fileHashes: Record<string, string>): Promise<void> {
    const keyFiles = await this.getKeyProjectFiles(projectPath);
    const keyFileResults = await Promise.all(
      keyFiles.map(async (filePath) => {
        try {
          const stats = await stat(filePath);
          const relativePath = filePath.replace(projectPath, '').replace(/^[\/\\]/, '');
          return {
            path: relativePath,
            hash: fileHashes[relativePath] || '',
            lastModified: stats.mtime,
            size: stats.size
          };
        } catch {
          return null;
        }
      })
    );
    const keyFileInfos: ProjectFileInfo[] = keyFileResults.filter((info): info is ProjectFileInfo => info !== null);

    const validFileInfos = keyFileInfos.filter(Boolean) as ProjectFileInfo[];
    const gitCommitHash = await this.getGitCommitHash(projectPath);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO project_metadata 
      (project_path, project_hash, key_files, last_analyzed, git_commit_hash)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      projectPath,
      projectHash,
      JSON.stringify(validFileInfos),
      new Date().toISOString(),
      gitCommitHash
    );
  }

  private async updateSessionLastUsed(sessionId: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE foundation_sessions 
      SET last_used = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(sessionId);

    // Update memory cache
    const session = this.sessionCache.get(sessionId);
    if (session) {
      session.last_used = new Date();
    }
  }

  private async updateSessionValidation(sessionId: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE foundation_sessions 
      SET last_validated = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(sessionId);

    // Update memory cache
    const session = this.sessionCache.get(sessionId);
    if (session) {
      session.last_validated = new Date();
    }
  }

  private async getFoundationSessionsByProject(projectPath: string): Promise<FoundationSession[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM foundation_sessions 
      WHERE project_path = ?
      ORDER BY last_used DESC
    `);

    const rows = stmt.all(projectPath) as any[];
    return rows.map(row => this.rowToFoundationSession(row));
  }

  private async removeFoundationSession(sessionId: string): Promise<void> {
    const stmt = this.db.prepare(`DELETE FROM foundation_sessions WHERE id = ?`);
    stmt.run(sessionId);

    // Remove from memory cache
    this.sessionCache.delete(sessionId);
  }

  private async removeProjectMetadata(projectPath: string): Promise<void> {
    const stmt = this.db.prepare(`DELETE FROM project_metadata WHERE project_path = ?`);
    stmt.run(projectPath);
  }

  private rowToFoundationSession(row: any): FoundationSession {
    return {
      id: row.id,
      project_path: row.project_path,
      base_context: JSON.parse(row.base_context),
      created_at: new Date(row.created_at),
      last_used: new Date(row.last_used),
      total_tokens_saved: row.total_tokens_saved,
      cache_hits: row.cache_hits,
      cache_misses: row.cache_misses,
      derived_sessions: JSON.parse(row.derived_sessions || '[]'),
      project_hash: row.project_hash || '',
      file_hashes: JSON.parse(row.file_hashes || '{}'),
      last_validated: new Date(row.last_validated || row.created_at || Date.now())
    };
  }

  /**
   * Find the project root by looking for common project markers
   */
  private findProjectRoot(filePath: string): string {
    let currentDir = dirname(resolve(filePath));
    
    const projectMarkers = [
      'package.json',
      'tsconfig.json',
      'CLAUDE.md',
      'pyproject.toml',
      'Cargo.toml',
      'go.mod',
      'composer.json',
      'pom.xml',
      'build.gradle',
      '.git',
      'Makefile'
    ];
    
    while (currentDir !== dirname(currentDir)) {
      for (const marker of projectMarkers) {
        try {
          const markerPath = join(currentDir, marker);
          // Use synchronous check for simplicity
          statSync(markerPath);
          return currentDir;
        } catch {
          // Continue searching
        }
      }
      
      currentDir = dirname(currentDir);
    }
    
    // Default to the directory containing the file
    return dirname(resolve(filePath));
  }

  private generateContentHash(content: string, templateId: string): string {
    return createHash('sha256')
      .update(content + '::' + templateId)
      .digest('hex');
  }

  private generateSessionId(): string {
    return randomUUID();
  }

  private generateCacheId(): string {
    return `cache_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private findCacheEntry(contentHash: string, templateId: string, sessionId?: string): CacheEntry | null {
    const stmt = this.db.prepare(`
      SELECT * FROM cache_entries 
      WHERE content_hash = ? AND template_id = ? 
      AND (session_id = ? OR session_id = 'default')
      ORDER BY session_id = ? DESC, created_at DESC
      LIMIT 1
    `);

    const row = stmt.get(contentHash, templateId, sessionId || 'default', sessionId || 'default');
    return row ? this.rowToCacheEntry(row) : null;
  }

  private async findInFoundationCache(contentHash: string, templateId: string, sessionId: string): Promise<CacheEntry | null> {
    const foundationSessionId = await this.findFoundationSessionId(sessionId);
    if (!foundationSessionId) return null;

    const stmt = this.db.prepare(`
      SELECT * FROM cache_entries 
      WHERE content_hash = ? AND template_id = ? AND foundation_session_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const row = stmt.get(contentHash, templateId, foundationSessionId);
    return row ? this.rowToCacheEntry(row) : null;
  }

  private async findFoundationSessionId(sessionId?: string): Promise<string | null> {
    if (!sessionId) return null;

    // Check if this sessionId is itself a foundation session
    const directSession = this.sessionCache.get(sessionId) || await this.getFoundationSession(sessionId);
    if (directSession) return sessionId;

    // Check if this sessionId is derived from a foundation session
    const stmt = this.db.prepare(`
      SELECT id FROM foundation_sessions 
      WHERE JSON_EXTRACT(derived_sessions, '$') LIKE '%' || ? || '%'
    `);

    const row = stmt.get(sessionId) as { id: string } | undefined;
    return row ? row.id : null;
  }

  private async getFoundationSession(sessionId: string): Promise<FoundationSession | null> {
    if (this.sessionCache.has(sessionId)) {
      return this.sessionCache.get(sessionId)!;
    }

    const stmt = this.db.prepare('SELECT * FROM foundation_sessions WHERE id = ?');
    const row = stmt.get(sessionId) as any;
    
    if (!row) return null;

    const session: FoundationSession = {
      id: row.id,
      project_path: row.project_path,
      base_context: JSON.parse(row.base_context),
      created_at: new Date(row.created_at),
      last_used: new Date(row.last_used),
      total_tokens_saved: row.total_tokens_saved,
      cache_hits: row.cache_hits,
      cache_misses: row.cache_misses,
      derived_sessions: JSON.parse(row.derived_sessions),
      project_hash: row.project_hash || '',
      file_hashes: JSON.parse(row.file_hashes || '{}'),
      last_validated: row.last_validated ? new Date(row.last_validated) : new Date()
    };

    this.sessionCache.set(sessionId, session);
    return session;
  }

  private rowToCacheEntry(row: any): CacheEntry {
    return {
      id: row.id,
      content_hash: row.content_hash,
      template_id: row.template_id,
      file_path: row.file_path,
      session_id: row.session_id,
      foundation_session_id: row.foundation_session_id,
      result: JSON.parse(row.result),
      tokens_used: row.tokens_used,
      tokens_saved: row.tokens_saved,
      created_at: new Date(row.created_at),
      last_accessed: new Date(row.last_accessed),
      access_count: row.access_count,
      expires_at: row.expires_at ? new Date(row.expires_at) : undefined
    };
  }

  private isExpired(entry: CacheEntry): boolean {
    return entry.expires_at ? entry.expires_at < new Date() : false;
  }

  private updateAccessMetrics(entry: CacheEntry): void {
    entry.last_accessed = new Date();
    entry.access_count++;

    // Update in database
    const stmt = this.db.prepare(`
      UPDATE cache_entries 
      SET last_accessed = ?, access_count = ?
      WHERE id = ?
    `);
    stmt.run(entry.last_accessed.toISOString(), entry.access_count, entry.id);

    // Update foundation session metrics
    if (entry.foundation_session_id) {
      this.updateFoundationSessionMetrics(entry.foundation_session_id, entry.tokens_saved, 0);
    }
  }

  private async updateFoundationSessionMetrics(sessionId: string, tokensSaved: number, cacheMisses: number): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE foundation_sessions 
      SET total_tokens_saved = total_tokens_saved + ?,
          cache_hits = cache_hits + ?,
          cache_misses = cache_misses + ?,
          last_used = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    const cacheHits = tokensSaved > 0 ? 1 : 0;
    stmt.run(tokensSaved, cacheHits, cacheMisses, sessionId);

    // Update memory cache
    const session = this.sessionCache.get(sessionId);
    if (session) {
      session.total_tokens_saved += tokensSaved;
      session.cache_hits += cacheHits;
      session.cache_misses += cacheMisses;
      session.last_used = new Date();
    }
  }

  private estimateTokensSaved(content: string, result: any): number {
    // Simple heuristic: ~4 characters per token for content + result
    const contentTokens = Math.ceil(content.length / 4);
    const resultTokens = Math.ceil(JSON.stringify(result).length / 4);
    return contentTokens + Math.floor(resultTokens * 0.5); // Assume 50% of result contributes to savings
  }

  private recordMetric(metricType: string, metricKey: string, value: number): void {
    if (!this.config.enableMetrics) return;

    try {
      const stmt = this.db.prepare(`
        INSERT INTO cache_metrics (metric_type, metric_key, metric_value, timestamp)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `);
      stmt.run(metricType, metricKey, value);
    } catch (error) {
      console.warn('Failed to record cache metric:', error);
    }
  }

  private calculateHitRate(): number {
    try {
      const result = this.db.prepare(`
        SELECT 
          SUM(CASE WHEN metric_type LIKE 'cache_hit%' THEN metric_value ELSE 0 END) as hits,
          SUM(CASE WHEN metric_type = 'cache_miss' THEN metric_value ELSE 0 END) as misses
        FROM cache_metrics 
        WHERE timestamp > datetime('now', '-7 days')
      `).get() as { hits: number | null; misses: number | null };

      const hits = result.hits || 0;
      const misses = result.misses || 0;
      const total = hits + misses;
      
      return total > 0 ? hits / total : 0;
    } catch {
      return 0;
    }
  }

  private getRecentMetrics(): { hits: number; misses: number } {
    try {
      const result = this.db.prepare(`
        SELECT 
          SUM(CASE WHEN metric_type LIKE 'cache_hit%' THEN metric_value ELSE 0 END) as hits,
          SUM(CASE WHEN metric_type = 'cache_miss' THEN metric_value ELSE 0 END) as misses
        FROM cache_metrics 
        WHERE timestamp > datetime('now', '-1 day')
      `).get() as { hits: number | null; misses: number | null };

      return {
        hits: result.hits || 0,
        misses: result.misses || 0
      };
    } catch {
      return { hits: 0, misses: 0 };
    }
  }

  private getTopTemplates(): Array<{ templateId: string; hits: number; tokensSaved: number }> {
    try {
      const results = this.db.prepare(`
        SELECT 
          template_id,
          SUM(access_count) as hits,
          SUM(tokens_saved * access_count) as tokens_saved
        FROM cache_entries
        GROUP BY template_id
        ORDER BY hits DESC, tokens_saved DESC
        LIMIT 10
      `).all() as Array<{ template_id: string; hits: number; tokens_saved: number }>;

      return results.map(r => ({
        templateId: r.template_id,
        hits: r.hits,
        tokensSaved: r.tokens_saved
      }));
    } catch {
      return [];
    }
  }

  private calculateCacheEfficiency(): number {
    const recent = this.getRecentMetrics();
    const total = recent.hits + recent.misses;
    return total > 0 ? recent.hits / total : 0;
  }

  private cleanupMemoryCache(): void {
    const maxEntries = Math.floor(this.config.memoryLimitMB * 1024 * 1024 / 1000); // Rough estimation
    
    if (this.memoryCache.size > maxEntries) {
      // Remove least recently accessed entries
      const entries = Array.from(this.memoryCache.entries())
        .sort(([, a], [, b]) => a.last_accessed.getTime() - b.last_accessed.getTime());
      
      const toRemove = entries.slice(0, Math.floor(entries.length * 0.2)); // Remove 20%
      for (const [key] of toRemove) {
        this.memoryCache.delete(key);
      }
    }
  }

  private setupCleanupScheduler(): void {
    // Run cleanup every few hours
    setInterval(() => {
      this.performMaintenance().catch(console.error);
    }, this.config.cleanupIntervalHours * 60 * 60 * 1000);
    
    // Run validation every day
    setInterval(() => {
      this.validateFoundationSessions().then(report => {
        if (this.config.enableMetrics) {
          this.recordMetric('validation_total_sessions', 'daily', report.total);
          this.recordMetric('validation_invalid_sessions', 'daily', report.invalid);
          this.recordMetric('validation_stale_sessions', 'daily', report.stale);
        }
      }).catch(console.error);
    }, 24 * 60 * 60 * 1000); // 24 hours
  }

  /**
   * Closes the cache service and database connection
   */
  close(): void {
    this.db.close();
    this.memoryCache.clear();
    this.sessionCache.clear();
  }
}