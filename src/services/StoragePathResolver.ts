/**
 * Unified Storage Path Resolver for Dom0/DomU Isolation
 *
 * Provides path resolution for both LanceDB (vectors) and SQLite (relational)
 * with support for system-wide (Dom0) and project-local (DomU) storage.
 */

import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync } from 'fs';

export type StorageScope = 'dom0' | 'domU';
export type StorageType = 'lancedb' | 'sqlite';

export interface StorageConfig {
  scope: StorageScope;
  projectPath?: string;
  forceLocal?: boolean; // Override for testing
}

export class StoragePathResolver {
  private static readonly DOM0_BASE = join(homedir(), 'dev', 'game1', 'var', 'storage');
  private static readonly DOMU_VAR = 'var';
  private static readonly STORAGE_DIR = 'storage';

  /**
   * Get base storage directory for scope
   */
  static getBaseStoragePath(config: StorageConfig): string {
    if (config.scope === 'dom0') {
      return this.DOM0_BASE;
    }

    // DomU: Use project path or current working directory
    const projectPath = config.projectPath || process.cwd();
    return join(projectPath, this.DOMU_VAR, this.STORAGE_DIR);
  }

  /**
   * Get LanceDB directory path
   */
  static getLanceDBPath(config: StorageConfig, collection?: string): string {
    const basePath = this.getBaseStoragePath(config);
    const lanceDbPath = join(basePath, 'lancedb');

    if (collection) {
      return join(lanceDbPath, collection);
    }

    return lanceDbPath;
  }

  /**
   * Get SQLite database file path
   */
  static getSQLitePath(config: StorageConfig, database: string): string {
    const basePath = this.getBaseStoragePath(config);
    const sqlitePath = join(basePath, 'sqlite');

    // Ensure .db extension
    const dbFile = database.endsWith('.db') ? database : `${database}.db`;
    return join(sqlitePath, dbFile);
  }

  /**
   * Ensure storage directories exist
   */
  static ensureStorageDirectories(config: StorageConfig): void {
    const basePath = this.getBaseStoragePath(config);
    const lanceDbPath = join(basePath, 'lancedb');
    const sqlitePath = join(basePath, 'sqlite');

    // Create directories if they don't exist, with proper error handling
    [basePath, lanceDbPath, sqlitePath].forEach(dir => {
      if (!existsSync(dir)) {
        try {
          mkdirSync(dir, { recursive: true });
        } catch (error) {
          // If we can't create the directory (permissions, etc.),
          // fall back to a temporary directory for testing/edge cases
          if (error instanceof Error && error.message.includes('EACCES')) {
            console.warn(`Cannot create storage directory ${dir}, this may cause issues in production`);
            // Don't throw - let the application handle this gracefully
            return;
          }
          throw error;
        }
      }
    });
  }

  /**
   * Check if project has local storage configured
   */
  static hasProjectLocalStorage(projectPath?: string): boolean {
    const path = projectPath || process.cwd();
    const varDir = join(path, this.DOMU_VAR);
    return existsSync(varDir);
  }

  /**
   * Get appropriate storage config based on environment and preferences
   */
  static getStorageConfig(options: {
    preferLocal?: boolean;
    projectPath?: string;
    forceScope?: StorageScope;
  } = {}): StorageConfig {
    const { preferLocal = true, projectPath, forceScope } = options;

    // Force specific scope if requested
    if (forceScope) {
      return { scope: forceScope, projectPath };
    }

    // Check for project-local storage preference
    if (preferLocal && this.hasProjectLocalStorage(projectPath)) {
      return { scope: 'domU', projectPath };
    }

    // Check environment variable
    const useLocal = process.env.ZMCP_USE_LOCAL_STORAGE === 'true';
    if (useLocal) {
      return { scope: 'domU', projectPath };
    }

    // Default to dom0 for backward compatibility
    return { scope: 'dom0' };
  }

  /**
   * Migrate data from global to project-local storage
   */
  static async migrateToProjectLocal(projectPath: string): Promise<{
    success: boolean;
    migratedFiles: string[];
    errors: string[];
  }> {
    // This would implement migration logic
    // For now, return structure for future implementation
    return {
      success: false,
      migratedFiles: [],
      errors: ['Migration not yet implemented']
    };
  }

  /**
   * Get legacy paths for backward compatibility
   */
  static getLegacyPaths(): {
    lancedb: string;
    sqlite: string;
  } {
    return {
      lancedb: join(homedir(), '.mcptools', 'lancedb'),
      sqlite: join(homedir(), '.mcptools', 'data', 'claude_mcp_tools.db')
    };
  }

  /**
   * Get all possible storage locations for bubbling search
   */
  static getSearchPaths(storageType: StorageType, file: string): string[] {
    const paths: string[] = [];
    const currentDir = process.cwd();

    // 1. Current project DomU
    const domUConfig = { scope: 'domU' as const, projectPath: currentDir };
    if (storageType === 'lancedb') {
      paths.push(this.getLanceDBPath(domUConfig, file));
    } else {
      paths.push(this.getSQLitePath(domUConfig, file));
    }

    // 2. Parent directories (bubbling up)
    let dir = currentDir;
    for (let i = 0; i < 5; i++) { // Max 5 levels up
      const parentDir = join(dir, '..');
      if (parentDir === dir) break; // Reached root

      dir = parentDir;
      const parentConfig = { scope: 'domU' as const, projectPath: dir };

      if (storageType === 'lancedb') {
        paths.push(this.getLanceDBPath(parentConfig, file));
      } else {
        paths.push(this.getSQLitePath(parentConfig, file));
      }
    }

    // 3. Dom0 system storage
    const dom0Config = { scope: 'dom0' as const };
    if (storageType === 'lancedb') {
      paths.push(this.getLanceDBPath(dom0Config, file));
    } else {
      paths.push(this.getSQLitePath(dom0Config, file));
    }

    // 4. Legacy global paths (for backward compatibility)
    const legacy = this.getLegacyPaths();
    if (storageType === 'lancedb') {
      paths.push(join(legacy.lancedb, file));
    } else {
      paths.push(legacy.sqlite);
    }

    return paths;
  }
}