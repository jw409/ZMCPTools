import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { mkdirSync, existsSync } from 'fs';

export interface DatabaseConfig {
  path?: string;
  wal?: boolean;
  timeout?: number;
  verbose?: boolean;
}

export class ClaudeDatabase {
  private db: Database.Database;
  private initialized = false;

  constructor(config: DatabaseConfig = {}) {
    const dbPath = config.path || join(homedir(), '.mcptools', 'data', 'orchestration.db');
    
    // Ensure directory exists
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(dbPath, {
      verbose: config.verbose ? console.log : undefined,
      timeout: config.timeout || 30000,
    });

    this.initializePragmas(config.wal !== false);
  }

  private initializePragmas(enableWal = true): void {
    // Optimize SQLite for concurrent access
    if (enableWal) {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.pragma('busy_timeout = 30000');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000'); // 64MB cache
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('foreign_keys = ON');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    await this.runMigrations();
    this.initialized = true;
  }

  private async runMigrations(): Promise<void> {
    // Create migration tracking table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Apply migrations in order
    const migrations = this.getMigrations();
    const appliedMigrations = this.getAppliedMigrations();
    
    for (const migration of migrations) {
      if (!appliedMigrations.includes(migration.version)) {
        console.log(`Applying migration: ${migration.version}`);
        this.db.exec(migration.sql);
        this.db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(migration.version);
      }
    }
  }

  private getMigrations(): Array<{ version: string; sql: string }> {
    return [
      {
        version: '001_initial_schema',
        sql: `
          -- Agent Sessions
          CREATE TABLE agent_sessions (
            id TEXT PRIMARY KEY,
            agent_name TEXT NOT NULL,
            repository_path TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            claude_pid INTEGER,
            capabilities TEXT, -- JSON array
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_heartbeat DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            agent_metadata TEXT -- JSON object
          );

          -- Tasks
          CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            repository_path TEXT NOT NULL,
            task_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            assigned_agent_id TEXT,
            parent_task_id TEXT,
            priority INTEGER NOT NULL DEFAULT 0,
            description TEXT NOT NULL,
            requirements TEXT, -- JSON
            results TEXT, -- JSON
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (assigned_agent_id) REFERENCES agent_sessions(id),
            FOREIGN KEY (parent_task_id) REFERENCES tasks(id)
          );

          -- Task Dependencies
          CREATE TABLE task_dependencies (
            task_id TEXT NOT NULL,
            depends_on_task_id TEXT NOT NULL,
            dependency_type TEXT NOT NULL DEFAULT 'completion',
            PRIMARY KEY (task_id, depends_on_task_id),
            FOREIGN KEY (task_id) REFERENCES tasks(id),
            FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id)
          );

          -- Chat Rooms
          CREATE TABLE chat_rooms (
            name TEXT PRIMARY KEY,
            description TEXT,
            repository_path TEXT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            room_metadata TEXT -- JSON
          );

          -- Chat Messages
          CREATE TABLE chat_messages (
            id TEXT PRIMARY KEY,
            room_name TEXT NOT NULL,
            agent_name TEXT NOT NULL,
            message TEXT NOT NULL,
            timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            mentions TEXT, -- JSON array
            message_type TEXT NOT NULL DEFAULT 'standard',
            FOREIGN KEY (room_name) REFERENCES chat_rooms(name)
          );

          -- Memories (Shared Memory)
          CREATE TABLE memories (
            id TEXT PRIMARY KEY,
            repository_path TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            entry_type TEXT NOT NULL,
            category TEXT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            tags TEXT, -- JSON array
            misc_data TEXT, -- JSON
            context TEXT, -- JSON
            confidence REAL NOT NULL DEFAULT 0.8,
            relevance_score REAL NOT NULL DEFAULT 1.0,
            usefulness_score REAL NOT NULL DEFAULT 0.0,
            accessed_count INTEGER NOT NULL DEFAULT 0,
            referenced_count INTEGER NOT NULL DEFAULT 0,
            last_accessed DATETIME,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (agent_id) REFERENCES agent_sessions(id)
          );

          CREATE INDEX idx_memories_repository_path ON memories(repository_path);
          CREATE INDEX idx_memories_entry_type ON memories(entry_type);
          CREATE INDEX idx_memories_category ON memories(category);

          -- Documentation Sources
          CREATE TABLE documentation_sources (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            source_type TEXT NOT NULL DEFAULT 'GUIDE',
            crawl_depth INTEGER NOT NULL DEFAULT 3,
            update_frequency TEXT NOT NULL DEFAULT 'DAILY',
            selectors TEXT, -- JSON
            allow_patterns TEXT, -- JSON array
            ignore_patterns TEXT, -- JSON array
            include_subdomains BOOLEAN DEFAULT 0,
            last_scraped DATETIME,
            status TEXT NOT NULL DEFAULT 'NOT_STARTED',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            source_metadata TEXT -- JSON
          );

          -- Scrape Jobs for coordination
          CREATE TABLE scrape_jobs (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            job_data TEXT NOT NULL, -- JSON
            status TEXT NOT NULL DEFAULT 'pending',
            locked_by TEXT,
            locked_at DATETIME,
            lock_timeout INTEGER NOT NULL DEFAULT 3600,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            started_at DATETIME,
            completed_at DATETIME,
            error_message TEXT,
            pages_scraped INTEGER,
            result_data TEXT, -- JSON
            FOREIGN KEY (source_id) REFERENCES documentation_sources(id)
          );

          -- Error Logs
          CREATE TABLE error_logs (
            id TEXT PRIMARY KEY,
            repository_path TEXT NOT NULL,
            agent_id TEXT,
            task_id TEXT,
            error_type TEXT NOT NULL,
            error_category TEXT NOT NULL,
            error_message TEXT NOT NULL,
            error_details TEXT,
            context TEXT, -- JSON
            environment TEXT, -- JSON
            attempted_solution TEXT,
            resolution_status TEXT NOT NULL DEFAULT 'unresolved',
            resolution_details TEXT,
            pattern_id TEXT,
            severity TEXT NOT NULL DEFAULT 'medium',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            resolved_at DATETIME,
            FOREIGN KEY (agent_id) REFERENCES agent_sessions(id),
            FOREIGN KEY (task_id) REFERENCES tasks(id)
          );

          CREATE INDEX idx_error_logs_repository_path ON error_logs(repository_path);

          -- Tool Call Logs
          CREATE TABLE tool_call_logs (
            id TEXT PRIMARY KEY,
            repository_path TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            task_id TEXT,
            tool_name TEXT NOT NULL,
            parameters TEXT, -- JSON
            result TEXT, -- JSON
            status TEXT NOT NULL,
            execution_time REAL,
            error_message TEXT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (agent_id) REFERENCES agent_sessions(id),
            FOREIGN KEY (task_id) REFERENCES tasks(id)
          );

          CREATE INDEX idx_tool_call_logs_repository_path ON tool_call_logs(repository_path);
        `
      }
    ];
  }

  private getAppliedMigrations(): string[] {
    try {
      const stmt = this.db.prepare('SELECT version FROM _migrations ORDER BY applied_at');
      return stmt.all().map((row: any) => row.version);
    } catch {
      return [];
    }
  }

  // Transaction wrapper with retry logic
  transaction<T>(fn: (db: Database.Database) => T, retries = 3): T {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return this.db.transaction(fn)(this.db);
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < retries && this.isRetryableError(error)) {
          const delay = Math.min(100 * Math.pow(2, attempt), 5000);
          // Simple synchronous delay for SQLite
          const start = Date.now();
          while (Date.now() - start < delay) {
            // Busy wait
          }
          continue;
        }
        break;
      }
    }
    
    throw lastError!;
  }

  private isRetryableError(error: any): boolean {
    const message = error.message?.toLowerCase() || '';
    return message.includes('database is locked') || 
           message.includes('busy') || 
           message.includes('timeout');
  }

  get database(): Database.Database {
    return this.db;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  close(): void {
    this.db.close();
  }
}