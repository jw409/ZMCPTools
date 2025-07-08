import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { mkdirSync, existsSync } from 'fs';
import { sql } from 'drizzle-orm';
import { Logger } from '../utils/logger.js';
import {
  allTables,
  agentSessions,
  tasks,
  taskDependencies,
  memories,
  chatRooms,
  chatMessages,
  documentationSources,
  scrapeJobs,
  scrapeJobEntries,
  errorLogs,
  toolCallLogs,
} from '../schemas/index.js';

export interface DatabaseConfig {
  path?: string;
  wal?: boolean;
  timeout?: number;
  verbose?: boolean;
}

export class DatabaseManager {
  private sqlite: Database.Database;
  private drizzleDb: BetterSQLite3Database<typeof allTables>;
  private initialized = false;
  private logger: Logger;

  constructor(config: DatabaseConfig = {}) {
    this.logger = new Logger('drizzle-manager');
    
    const dbPath = config.path || join(homedir(), '.mcptools', 'data', 'claude_mcp_tools.db');
    
    // Ensure database directory exists
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    try {
      this.sqlite = new Database(dbPath, {
        verbose: config.verbose ? ((message?: unknown) => this.logger.debug(String(message))) : undefined,
        timeout: config.timeout || 30000,
      });

      this.initializePragmas(config.wal !== false);
      
      // Initialize Drizzle with all table schemas
      this.drizzleDb = drizzle(this.sqlite, { 
        schema: allTables,
        logger: config.verbose ? {
          logQuery: (query: string, params?: unknown[]) => {
            this.logger.debug('SQL Query', { query, params });
          }
        } : false
      });

      this.logger.info('DrizzleManager initialized successfully', { 
        dbPath
      });
    } catch (error) {
      this.logger.error('Failed to initialize DrizzleManager', error);
      throw error;
    }
  }


  private initializePragmas(enableWal = true): void {
    try {
      // Optimize SQLite for concurrent access
      if (enableWal) {
        this.sqlite.pragma('journal_mode = WAL');
        this.logger.debug('Enabled WAL mode');
      }
      this.sqlite.pragma('busy_timeout = 30000');
      this.sqlite.pragma('synchronous = NORMAL');
      this.sqlite.pragma('cache_size = -64000'); // 64MB cache
      this.sqlite.pragma('temp_store = MEMORY');
      this.sqlite.pragma('foreign_keys = ON');
      
      this.logger.debug('SQLite pragmas configured');
    } catch (error) {
      this.logger.error('Failed to configure SQLite pragmas', error);
      throw error;
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      await this.syncSchema();
      this.initialized = true;
      this.logger.info('DrizzleManager initialization completed');
    } catch (error) {
      this.logger.error('Failed to initialize DrizzleManager', error);
      throw error;
    }
  }

  private async syncSchema(): Promise<void> {
    try {
      this.logger.info('Synchronizing database schema using drizzle-kit push...');
      
      // Try different package managers in order of preference
      const { execSync } = await import('child_process');
      const commands = [
        'npx drizzle-kit push',
        'pnpx drizzle-kit push', 
        'bunx drizzle-kit push',
        'yarn dlx drizzle-kit push'
      ];

      let lastError: Error | undefined;
      
      for (const command of commands) {
        try {
          this.logger.debug(`Trying command: ${command}`);
          execSync(command, { 
            stdio: 'inherit',
            cwd: process.cwd()
          });
          this.logger.info(`Schema synchronization completed successfully using: ${command}`);
          return;
        } catch (error) {
          lastError = error as Error;
          this.logger.debug(`Command failed: ${command}`, error);
          continue;
        }
      }
      
      throw lastError || new Error('All drizzle-kit push commands failed');
    } catch (error) {
      this.logger.error('Schema synchronization failed', error);
      throw error;
    }
  }



  // Transaction wrapper with retry logic - maintains compatibility
  transaction<T>(fn: (db: BetterSQLite3Database<typeof allTables>) => T, retries = 3): T {
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return this.drizzleDb.transaction((tx) => {
          return fn(tx);
        });
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < retries && this.isRetryableError(error)) {
          const delay = Math.min(100 * Math.pow(2, attempt), 5000);
          this.logger.warn(`Transaction failed, retrying in ${delay}ms`, { 
            attempt: attempt + 1, 
            error: (error as Error).message 
          });
          
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
    
    this.logger.error('Transaction failed after all retries', lastError);
    throw lastError || new Error('Transaction failed with unknown error');
  }

  private isRetryableError(error: any): boolean {
    const message = error.message?.toLowerCase() || '';
    return message.includes('database is locked') || 
           message.includes('busy') || 
           message.includes('timeout');
  }

  // Backward compatibility methods
  get database(): Database.Database {
    return this.sqlite;
  }

  get db(): Database.Database {
    return this.sqlite;
  }

  get drizzle(): BetterSQLite3Database<typeof allTables> {
    return this.drizzleDb;
  }

  get useDrizzle(): boolean {
    return true; // DrizzleManager always uses Drizzle
  }

  getMigrations(): Array<{ version: string; sql: string }> {
    // Return empty array since DrizzleManager handles migrations differently
    return [];
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // Schema migration helpers
  async runSchemaMigration(migrationSql: string, version: string): Promise<void> {
    try {
      this.logger.info(`Running schema migration: ${version}`);
      
      // Check if migration already applied
      const existingMigration = this.sqlite
        .prepare('SELECT hash FROM __drizzle_migrations WHERE hash = ?')
        .get(version);
      
      if (existingMigration) {
        this.logger.info(`Migration ${version} already applied, skipping`);
        return;
      }

      // Run the migration within a transaction
      this.transaction((tx) => {
        tx.run(sql.raw(migrationSql));
        // Mark migration as applied
        this.sqlite
          .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
          .run(version, Date.now());
      });

      this.logger.info(`Schema migration ${version} completed successfully`);
    } catch (error) {
      this.logger.error(`Schema migration ${version} failed`, error);
      throw error;
    }
  }

  async getAppliedMigrations(): Promise<string[]> {
    try {
      const migrations = this.sqlite
        .prepare('SELECT hash FROM __drizzle_migrations ORDER BY created_at')
        .all() as Array<{ hash: string }>;
      
      return migrations.map(m => m.hash);
    } catch (error) {
      this.logger.debug('No migrations table found or error reading migrations', error);
      return [];
    }
  }

  // Health check method
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: Record<string, any> }> {
    try {
      // Test basic connectivity
      const result = this.sqlite.prepare('SELECT 1 as test').get() as { test: number };
      
      if (result.test !== 1) {
        throw new Error('Basic connectivity test failed');
      }

      // Check WAL mode
      const walMode = this.sqlite.pragma('journal_mode', { simple: true }) as string;
      
      // Check foreign keys
      const foreignKeys = this.sqlite.pragma('foreign_keys', { simple: true }) as number;

      return {
        status: 'healthy',
        details: {
          initialized: this.initialized,
          walMode,
          foreignKeysEnabled: foreignKeys === 1,
        }
      };
    } catch (error) {
      this.logger.error('Health check failed', error);
      return {
        status: 'unhealthy',
        details: {
          error: (error as Error).message,
          initialized: this.initialized,
        }
      };
    }
  }

  close(): void {
    try {
      this.logger.info('Closing DrizzleManager...');
      this.sqlite.close();
      this.initialized = false;
      this.logger.info('DrizzleManager closed successfully');
    } catch (error) {
      this.logger.error('Error closing DrizzleManager', error);
    }
  }
}

// Export a default instance for convenience
export default DatabaseManager;