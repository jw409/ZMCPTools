/**
 * Analysis Storage Service
 * SQLite-based storage for code analysis with dom0/domU isolation pattern
 * Supports multi-level recursive context resolution for shared learning
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import Database from 'better-sqlite3';
import { Logger } from '../utils/logger.js';
import { StoragePathResolver } from './StoragePathResolver.js';

export interface ContextPaths {
  project: string | null;    // Current repo (domU) - project_map.db
  ecosystem: string | null;  // Parent shared context (dom0) - system_patterns.db
  global: string | null;     // Optional global patterns
}

export interface AnalysisContext {
  id: number;
  contextPath: string;
  contextLevel: 'project' | 'ecosystem' | 'global';
  parentContextId: number | null;
  ecosystemName: string | null;
  projectName: string | null;
  createdAt: Date;
}

export interface FileAnalysisData {
  filePath: string;
  hash: string;
  lastModified: Date;
  symbols: SymbolInfo[];
  imports: string[];
  exports: string[];
  size: number;
  language: string;
}

export interface SymbolInfo {
  name: string;
  type: 'function' | 'class' | 'variable' | 'interface' | 'type' | 'enum';
  line: number;
  column: number;
  isExported: boolean;
  accessibility?: 'public' | 'private' | 'protected';
}

export interface AnalysisRun {
  id: number;
  startedAt: Date;
  completedAt: Date | null;
  status: 'running' | 'completed' | 'failed';
  filesAnalyzed: number;
  errors: string[] | null;
  contextId: number;
}

export class AnalysisStorageService {
  private logger: Logger;
  private databases: Map<string, Database.Database> = new Map();
  private contextCache: Map<string, ContextPaths> = new Map();

  constructor() {
    this.logger = new Logger('analysis-storage');
  }

  /**
   * Resolve context paths for current working directory or provided path
   */
  async resolveContextPaths(startPath: string = process.cwd()): Promise<ContextPaths> {
    // Check cache first
    const cacheKey = path.resolve(startPath);
    if (this.contextCache.has(cacheKey)) {
      return this.contextCache.get(cacheKey)!;
    }

    const contexts: ContextPaths = {
      project: null,
      ecosystem: null,
      global: null
    };

    let currentPath = path.resolve(startPath);
    const foundAnalysisDirs: { path: string; level: number }[] = [];

    // Walk up directory tree
    let level = 0;
    while (currentPath !== path.dirname(currentPath)) {
      const analysisPath = path.join(currentPath, 'var/analysis');

      // Check if this level should have analysis
      const isProjectRoot = await this.isProjectRoot(currentPath);

      if (existsSync(analysisPath)) {
        foundAnalysisDirs.push({ path: analysisPath, level });
      } else if (isProjectRoot && level === 0) {
        // Current project should have analysis but doesn't - will create it
        contexts.project = path.join(analysisPath, 'project_map.db');
      }

      // Special detection for ecosystem roots (~/dev/game1, ~/dev/meshly)
      const basename = path.basename(currentPath);
      const parentBase = path.basename(path.dirname(currentPath));

      if (parentBase === 'dev' && (basename === 'meshly' || basename === 'game1')) {
        // This is an ecosystem root
        if (!contexts.ecosystem) {
          contexts.ecosystem = path.join(currentPath, 'var/analysis/system_patterns.db');
        }
      }

      currentPath = path.dirname(currentPath);
      level++;

      // Safety break - don't go beyond home directory
      if (currentPath === homedir()) {
        break;
      }
    }

    // Assign contexts based on what we found
    if (foundAnalysisDirs.length > 0) {
      // Closest one is the project
      contexts.project = path.join(foundAnalysisDirs[0].path, 'project_map.db');

      // Next one up (if exists) is ecosystem
      if (foundAnalysisDirs.length > 1) {
        contexts.ecosystem = path.join(foundAnalysisDirs[1].path, 'system_patterns.db');
      }
    }

    // Fallback detection if ecosystem not found but project exists
    if (!contexts.ecosystem && contexts.project) {
      // Check if we're in a known ecosystem based on project path
      if (contexts.project.includes('/dev/meshly/')) {
        const meshlyConfig = StoragePathResolver.getStorageConfig({
          forceScope: 'dom0',
          projectPath: path.join(homedir(), 'dev/meshly')
        });
        StoragePathResolver.ensureStorageDirectories(meshlyConfig);
        contexts.ecosystem = StoragePathResolver.getSQLitePath(meshlyConfig, 'system_patterns');
      } else if (contexts.project.includes('/dev/game1/')) {
        const game1Config = StoragePathResolver.getStorageConfig({
          forceScope: 'dom0',
          projectPath: path.join(homedir(), 'dev/game1')
        });
        StoragePathResolver.ensureStorageDirectories(game1Config);
        contexts.ecosystem = StoragePathResolver.getSQLitePath(game1Config, 'system_patterns');
      }
    }

    // Optional global context using StoragePathResolver
    const globalConfig = StoragePathResolver.getStorageConfig({ forceScope: 'dom0' });
    StoragePathResolver.ensureStorageDirectories(globalConfig);
    contexts.global = StoragePathResolver.getSQLitePath(globalConfig, 'global_patterns');

    // Cache the result
    this.contextCache.set(cacheKey, contexts);
    this.logger.info('Resolved context paths', {
      startPath: cacheKey,
      project: contexts.project,
      ecosystem: contexts.ecosystem,
      global: contexts.global
    });

    return contexts;
  }

  /**
   * Check if a directory is a project root (has markers like .git, package.json, etc.)
   */
  private async isProjectRoot(dirPath: string): Promise<boolean> {
    const markers = [
      '.git',
      'package.json',
      'pyproject.toml',
      'Cargo.toml',
      'go.mod',
      'CLAUDE.md',
      '.projectroot'
    ];

    for (const marker of markers) {
      const markerPath = path.join(dirPath, marker);
      if (existsSync(markerPath)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get or create database connection for a specific context
   */
  async getDatabase(scope: 'project' | 'ecosystem' | 'global', projectPath?: string): Promise<Database.Database> {
    const contexts = await this.resolveContextPaths(projectPath);

    let dbPath: string;
    switch (scope) {
      case 'project':
        if (!contexts.project) {
          throw new Error(`No project context found for path: ${projectPath || process.cwd()}`);
        }
        dbPath = contexts.project;
        break;
      case 'ecosystem':
        if (!contexts.ecosystem) {
          throw new Error(`No ecosystem context found for path: ${projectPath || process.cwd()}`);
        }
        dbPath = contexts.ecosystem;
        break;
      case 'global':
        if (!contexts.global) {
          throw new Error('No global context configured');
        }
        dbPath = contexts.global;
        break;
    }

    // Check if we already have this database open
    if (this.databases.has(dbPath)) {
      return this.databases.get(dbPath)!;
    }

    // Ensure directory exists
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    // Create database connection
    const db = new Database(dbPath);

    // Configure database for optimal performance and safety
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = 10000');
    db.pragma('temp_store = memory');
    db.pragma('mmap_size = 268435456'); // 256MB

    // Initialize schema
    await this.initializeSchema(db, scope);

    this.databases.set(dbPath, db);
    this.logger.info(`Database initialized`, { scope, path: dbPath });

    return db;
  }

  /**
   * Initialize database schema for a specific scope
   */
  private async initializeSchema(db: Database.Database, scope: 'project' | 'ecosystem' | 'global'): Promise<void> {
    // Base schema from the GitHub issue requirements
    const baseSchema = `
      -- Context hierarchy tracking
      CREATE TABLE IF NOT EXISTS context_hierarchy (
        id INTEGER PRIMARY KEY,
        context_path TEXT NOT NULL UNIQUE,
        context_level TEXT CHECK(context_level IN ('project', 'ecosystem', 'global')),
        parent_context_id INTEGER REFERENCES context_hierarchy(id),
        ecosystem_name TEXT,
        project_name TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Metadata tracking
      CREATE TABLE IF NOT EXISTS analysis_metadata (
        id INTEGER PRIMARY KEY,
        project_path TEXT NOT NULL,
        analysis_type TEXT NOT NULL,
        version TEXT DEFAULT '1.0.0',
        context_id INTEGER REFERENCES context_hierarchy(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_path, analysis_type)
      );

      -- File tracking for incremental updates
      CREATE TABLE IF NOT EXISTS file_hashes (
        file_path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        size INTEGER,
        last_modified TIMESTAMP,
        analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        context_id INTEGER REFERENCES context_hierarchy(id)
      );

      -- Analysis runs audit log
      CREATE TABLE IF NOT EXISTS analysis_runs (
        id INTEGER PRIMARY KEY,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        status TEXT CHECK(status IN ('running', 'completed', 'failed')),
        files_analyzed INTEGER DEFAULT 0,
        errors TEXT, -- JSON array of errors
        context_id INTEGER REFERENCES context_hierarchy(id)
      );

      -- Symbols tracking (functions, classes, variables, etc.)
      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY,
        file_path TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT CHECK(type IN ('function', 'class', 'variable', 'interface', 'type', 'enum')),
        line INTEGER NOT NULL,
        column INTEGER NOT NULL,
        is_exported BOOLEAN DEFAULT FALSE,
        accessibility TEXT CHECK(accessibility IN ('public', 'private', 'protected')),
        context_id INTEGER REFERENCES context_hierarchy(id),
        FOREIGN KEY (file_path) REFERENCES file_hashes(file_path) ON DELETE CASCADE
      );

      -- Imports and exports tracking for dependency analysis
      CREATE TABLE IF NOT EXISTS imports_exports (
        id INTEGER PRIMARY KEY,
        file_path TEXT NOT NULL,
        type TEXT CHECK(type IN ('import', 'export')),
        symbol_name TEXT,
        module_path TEXT,
        is_default BOOLEAN DEFAULT FALSE,
        context_id INTEGER REFERENCES context_hierarchy(id),
        FOREIGN KEY (file_path) REFERENCES file_hashes(file_path) ON DELETE CASCADE
      );

      -- Pattern promotion tracking (for learning between contexts)
      CREATE TABLE IF NOT EXISTS pattern_promotion (
        id INTEGER PRIMARY KEY,
        pattern_id INTEGER,
        source_context_id INTEGER REFERENCES context_hierarchy(id),
        target_context_id INTEGER REFERENCES context_hierarchy(id),
        promoted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        promoted_by TEXT,
        reason TEXT
      );

      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_symbols_file_path ON symbols(file_path);
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_symbols_type ON symbols(type);
      CREATE INDEX IF NOT EXISTS idx_imports_exports_file_path ON imports_exports(file_path);
      CREATE INDEX IF NOT EXISTS idx_imports_exports_module ON imports_exports(module_path);
      CREATE INDEX IF NOT EXISTS idx_file_hashes_context ON file_hashes(context_id);
      CREATE INDEX IF NOT EXISTS idx_analysis_runs_context ON analysis_runs(context_id);
    `;

    // Execute schema creation
    db.exec(baseSchema);

    // Insert or update context record for this database
    const contextPath = db.name;
    const ecosystemName = this.extractEcosystemName(contextPath);
    const projectName = this.extractProjectName(contextPath);

    const insertContext = db.prepare(`
      INSERT OR REPLACE INTO context_hierarchy
      (context_path, context_level, ecosystem_name, project_name)
      VALUES (?, ?, ?, ?)
    `);

    insertContext.run(contextPath, scope, ecosystemName, projectName);

    this.logger.info(`Schema initialized for ${scope} context`, {
      path: contextPath,
      ecosystem: ecosystemName,
      project: projectName
    });
  }

  /**
   * Extract ecosystem name from database path
   */
  private extractEcosystemName(dbPath: string): string | null {
    if (dbPath.includes('/dev/meshly/')) return 'meshly';
    if (dbPath.includes('/dev/game1/')) return 'game1';
    return null;
  }

  /**
   * Extract project name from database path
   */
  private extractProjectName(dbPath: string): string | null {
    const match = dbPath.match(/\/dev\/[^\/]+\/([^\/]+)\//);
    return match ? match[1] : null;
  }

  /**
   * Store file analysis data
   */
  async storeFileAnalysis(
    filePath: string,
    analysisData: FileAnalysisData,
    scope: 'project' | 'ecosystem' = 'project'
  ): Promise<void> {
    const db = await this.getDatabase(scope);

    // Get context ID
    const contextQuery = db.prepare('SELECT id FROM context_hierarchy WHERE context_path = ?');
    const context = contextQuery.get(db.name) as { id: number } | undefined;
    const contextId = context?.id || 1;

    const transaction = db.transaction(() => {
      // Insert/update file hash record
      const insertFile = db.prepare(`
        INSERT OR REPLACE INTO file_hashes
        (file_path, hash, size, last_modified, context_id)
        VALUES (?, ?, ?, ?, ?)
      `);
      insertFile.run(
        analysisData.filePath,
        analysisData.hash,
        analysisData.size,
        analysisData.lastModified.toISOString(),
        contextId
      );

      // Clear existing symbols for this file
      const deleteSymbols = db.prepare('DELETE FROM symbols WHERE file_path = ?');
      deleteSymbols.run(analysisData.filePath);

      // Insert new symbols
      const insertSymbol = db.prepare(`
        INSERT INTO symbols
        (file_path, name, type, line, column, is_exported, accessibility, context_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const symbol of analysisData.symbols) {
        insertSymbol.run(
          analysisData.filePath,
          symbol.name,
          symbol.type,
          symbol.line,
          symbol.column,
          symbol.isExported ? 1 : 0, // Convert boolean to integer for SQLite
          symbol.accessibility || null,
          contextId
        );
      }

      // Clear existing imports/exports for this file
      const deleteImportsExports = db.prepare('DELETE FROM imports_exports WHERE file_path = ?');
      deleteImportsExports.run(analysisData.filePath);

      // Insert imports
      const insertImportExport = db.prepare(`
        INSERT INTO imports_exports
        (file_path, type, symbol_name, module_path, context_id)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const importPath of analysisData.imports) {
        insertImportExport.run(analysisData.filePath, 'import', null, importPath, contextId);
      }

      // Insert exports
      for (const exportName of analysisData.exports) {
        insertImportExport.run(analysisData.filePath, 'export', exportName, null, contextId);
      }
    });

    transaction();

    this.logger.info(`Stored analysis for file`, {
      filePath: analysisData.filePath,
      symbolCount: analysisData.symbols.length,
      scope
    });
  }

  /**
   * Search for symbols across contexts with inheritance
   */
  async searchSymbols(
    query: string,
    symbolType?: string,
    projectPath?: string
  ): Promise<Array<SymbolInfo & { filePath: string; contextLevel: string }>> {
    const contexts = await this.resolveContextPaths(projectPath);
    const results: Array<SymbolInfo & { filePath: string; contextLevel: string }> = [];

    // Search in order: project → ecosystem → global
    for (const [level, dbPath] of [
      ['project', contexts.project],
      ['ecosystem', contexts.ecosystem],
      ['global', contexts.global]
    ]) {
      if (!dbPath || !existsSync(dbPath)) continue;

      try {
        const db = await this.getDatabase(level as any, projectPath);

        let searchQuery = `
          SELECT s.*, s.file_path as filePath
          FROM symbols s
          WHERE s.name LIKE ?
        `;
        const params = [`%${query}%`];

        if (symbolType) {
          searchQuery += ' AND s.type = ?';
          params.push(symbolType);
        }

        searchQuery += ' ORDER BY s.name';

        const stmt = db.prepare(searchQuery);
        const levelResults = stmt.all(...params) as any[];

        results.push(...levelResults.map(r => ({
          ...r,
          contextLevel: level,
          isExported: Boolean(r.is_exported)
        })));

      } catch (error) {
        this.logger.warn(`Failed to search symbols in ${level} context`, error);
      }
    }

    return results;
  }

  /**
   * Get file dependencies (what files does this file import/export)
   */
  async getFileDependencies(filePath: string, projectPath?: string): Promise<{
    imports: string[];
    exports: string[];
    dependents: string[]; // Files that import from this file
  }> {
    const db = await this.getDatabase('project', projectPath);

    // Get imports and exports for this file
    const importsExports = db.prepare(`
      SELECT type, symbol_name, module_path
      FROM imports_exports
      WHERE file_path = ?
    `).all(filePath) as Array<{
      type: 'import' | 'export';
      symbol_name: string | null;
      module_path: string | null;
    }>;

    const imports = importsExports
      .filter(ie => ie.type === 'import' && ie.module_path)
      .map(ie => ie.module_path!);

    const exports = importsExports
      .filter(ie => ie.type === 'export' && ie.symbol_name)
      .map(ie => ie.symbol_name!);

    // Find files that import from this file (dependents)
    const dependents = db.prepare(`
      SELECT DISTINCT file_path
      FROM imports_exports
      WHERE type = 'import' AND module_path = ?
    `).all(filePath).map((row: any) => row.file_path);

    return { imports, exports, dependents };
  }

  /**
   * Close all database connections
   */
  async shutdown(): Promise<void> {
    for (const [path, db] of this.databases) {
      try {
        db.close();
        this.logger.info(`Closed database: ${path}`);
      } catch (error) {
        this.logger.error(`Failed to close database: ${path}`, error);
      }
    }
    this.databases.clear();
    this.contextCache.clear();
  }
}