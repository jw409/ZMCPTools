import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync } from 'fs';

/**
 * Resolves paths for a self-contained CLI tool that needs to work from any directory
 * while always using its own bundled resources
 */
export class PathResolver {
  private static instance: PathResolver;
  private toolRoot: string;
  private _isGlobalInstall: boolean | null = null;
  private _projectRoot: string | null = null;
  
  constructor() {
    this.toolRoot = this.findToolRoot();
  }
  
  private findToolRoot(): string {
    // Start from current file location
    const __dirname = import.meta.dirname || dirname(fileURLToPath(import.meta.url));
    let current = __dirname;
    
    // Walk up from current script to find package.json
    while (current !== dirname(current)) {
      try {
        const packagePath = join(current, 'package.json');
        if (existsSync(packagePath)) {
          const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
          if (pkg.name === 'claude-mcp-tools') {
            return current;
          }
        }
      } catch {}
      current = dirname(current);
    }
    
    // Fallback: assume we're two levels up from src/utils
    return join(__dirname, '..', '..');
  }
  
  /**
   * Get the path to the bundled schemas
   */
  getSchemaPath(): string {
    return join(this.toolRoot, 'dist', 'schemas', 'index.js');
  }
  
  /**
   * Get the path to store migrations (bundled with the tool)
   */
  getMigrationsPath(): string {
    return join(this.toolRoot, 'migrations');
  }
  
  /**
   * Get the drizzle config path
   */
  getDrizzleConfigPath(): string {
    // Always use .ts version since we fixed the compatibility issues
    return join(this.toolRoot, 'drizzle.config.ts');
  }
  
  /**
   * Get user data directory (consistent with existing ~/.mcptools/data)
   */
  getUserDataPath(): string {
    return join(homedir(), '.mcptools', 'data');
  }
  
  /**
   * Get the database path
   */
  getDatabasePath(): string {
    return join(this.getUserDataPath(), 'claude_mcp_tools.db');
  }
  
  /**
   * Get the tool's root directory
   */
  getToolRoot(): string {
    return this.toolRoot;
  }
  
  /**
   * Determine if this is a global installation or development mode
   */
  isGlobalInstall(): boolean {
    if (this._isGlobalInstall !== null) {
      return this._isGlobalInstall;
    }

    // Check if we're running from global installation
    const cwd = process.cwd();
    const binPath = process.argv[1];
    
    // Global installations typically have node_modules in path
    // or don't have local package.json/tsconfig.json
    const isGlobal = binPath.includes('node_modules') || 
                     !existsSync(join(cwd, 'package.json')) ||
                     !existsSync(join(cwd, 'tsconfig.json'));
    
    this._isGlobalInstall = isGlobal;
    return isGlobal;
  }

  /**
   * Get the current project root (different from tool root)
   */
  getProjectRoot(): string {
    if (this._projectRoot !== null) {
      return this._projectRoot;
    }

    if (this.isGlobalInstall()) {
      // For global installs, project root is current working directory
      this._projectRoot = process.cwd();
    } else {
      // For development, project root is where package.json is
      let current = process.cwd();
      while (current !== dirname(current)) {
        if (existsSync(join(current, 'package.json'))) {
          this._projectRoot = current;
          break;
        }
        current = dirname(current);
      }
      this._projectRoot = current || process.cwd();
    }

    return this._projectRoot;
  }

  /**
   * Get the data directory (always ~/.mcptools/data)
   */
  getDataDirectory(): string {
    return join(homedir(), '.mcptools', 'data');
  }

  /**
   * Get the logs directory (always ~/.mcptools/logs)
   */
  getLogsDirectory(): string {
    return join(homedir(), '.mcptools', 'logs');
  }

  /**
   * Get the global directory (always ~/.mcptools)
   */
  getGlobalDirectory(): string {
    return join(homedir(), '.mcptools');
  }

  /**
   * Get project-specific config path
   */
  getConfigPath(): string {
    return join(this.getProjectRoot(), '.claude', 'settings.local.json');
  }

  /**
   * Get project-specific CLAUDE.md path
   */
  getClaudeMdPath(): string {
    return join(this.getProjectRoot(), 'CLAUDE.md');
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(): PathResolver {
    if (!PathResolver.instance) {
      PathResolver.instance = new PathResolver();
    }
    return PathResolver.instance;
  }
}

// Convenience export
export const pathResolver = PathResolver.getInstance();