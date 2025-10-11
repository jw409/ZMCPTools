import * as fs from 'fs/promises';
import { accessSync } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { FoundationCacheService } from './FoundationCacheService.js';
import { AnalysisStorageService } from './AnalysisStorageService.js';
import type { FileAnalysisData } from './AnalysisStorageService.js';
import { Logger } from '../utils/logger.js';

export interface ProjectOverview {
  projectPath: string;
  totalFiles: number;
  lastUpdated: Date;
  structure: DirectoryNode;
  symbolCount: number;
  metadata: ProjectMetadata;
}

export interface DirectoryNode {
  name: string;
  type: 'directory' | 'file';
  path: string;
  children?: DirectoryNode[];
  size?: number;
  lastModified?: Date;
}

export interface ProjectMetadata {
  name: string;
  description?: string;
  version?: string;
  technologies: string[];
  dependencies: string[];
  entryPoints: string[];
  configFiles: string[];
  buildOutputs: string[];
}

export interface FileAnalysis {
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
  accessibility?: 'public' | 'private' | 'protected';
  isExported: boolean;
}

export interface UpdateOptions {
  force?: boolean;
  maxAgeDays?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
}

/**
 * TreeSummaryService manages analysis data with SQLite storage backend.
 * Provides dom0/domU isolation for clean separation between ecosystem and project data.
 * Automatically integrates with FoundationCacheService for intelligent caching.
 */
export class TreeSummaryService {
  private readonly treeSummaryDir = '.treesummary';
  private readonly defaultIgnorePatterns = [
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '.next',
    '.nuxt',
    '.vite',
    'target',
    '__pycache__',
    '*.pyc',
    '.env*',
    '*.log',
    '.DS_Store',
    'Thumbs.db'
  ];

  private analysisStorage: AnalysisStorageService;
  private logger: Logger;

  constructor(private foundationCache?: FoundationCacheService) {
    this.analysisStorage = new AnalysisStorageService();
    this.logger = new Logger('tree-summary');
  }

  /**
   * Update file analysis for a specific file using SQLite storage
   */
  async updateFileAnalysis(filePath: string, analysisData: FileAnalysis): Promise<boolean> {
    try {
      // Invalidate relevant foundation cache entries
      if (this.foundationCache) {
        try {
          const projectPath = this.findProjectRoot(filePath);
          await this.foundationCache.invalidateCache({
            filePath: projectPath,
            templateId: 'project_overview'
          });
        } catch (error) {
          this.logger.warn('Failed to invalidate foundation cache:', error);
        }
      }

      // Convert to AnalysisStorageService format
      const storageData: FileAnalysisData = {
        filePath: analysisData.filePath,
        hash: analysisData.hash,
        lastModified: analysisData.lastModified,
        symbols: analysisData.symbols,
        imports: analysisData.imports,
        exports: analysisData.exports,
        size: analysisData.size,
        language: analysisData.language
      };

      // Store in SQLite
      await this.analysisStorage.storeFileAnalysis(
        filePath,
        storageData,
        'project' // Store in project context (domU)
      );

      this.logger.debug(`Stored analysis in SQLite: ${filePath}`);
      return true;

    } catch (error) {
      this.logger.error(`Failed to update file analysis: ${filePath}`, error);
      return false;
    }
  }

  /**
   * Remove file analysis for a deleted file from SQLite storage
   */
  async removeFileAnalysis(filePath: string): Promise<boolean> {
    try {
      // TODO: Add method to AnalysisStorageService to remove file analysis
      // For now, this is a placeholder as the primary use case is adding analysis
      this.logger.debug(`File removal requested: ${filePath}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to remove file analysis for ${filePath}:`, error);
      return false;
    }
  }

  /**
   * Search symbols using the AnalysisStorageService
   */
  async searchSymbols(
    query: string,
    symbolType?: string,
    projectPath?: string
  ): Promise<Array<SymbolInfo & { filePath: string; contextLevel: string }>> {
    try {
      return await this.analysisStorage.searchSymbols(query, symbolType, projectPath);
    } catch (error) {
      this.logger.error(`Failed to search symbols: ${query}`, error);
      return [];
    }
  }

  /**
   * Get file dependencies using the AnalysisStorageService
   */
  async getFileDependencies(filePath: string, projectPath?: string): Promise<{
    imports: string[];
    exports: string[];
    dependents: string[];
  }> {
    try {
      return await this.analysisStorage.getFileDependencies(filePath, projectPath);
    } catch (error) {
      this.logger.error(`Failed to get file dependencies: ${filePath}`, error);
      return { imports: [], exports: [], dependents: [] };
    }
  }

  /**
   * Find project root by looking for common project markers
   */
  findProjectRoot(filePath: string): string {
    const projectMarkers = [
      'package.json',
      'pyproject.toml',
      'Cargo.toml',
      'go.mod',
      '.git',
      'CLAUDE.md'
    ];

    let currentPath = path.dirname(filePath);

    while (currentPath !== path.dirname(currentPath)) {
      for (const marker of projectMarkers) {
        const markerPath = path.join(currentPath, marker);
        try {
          accessSync(markerPath);
          return currentPath;
        } catch {
          // Continue searching
        }
      }
      currentPath = path.dirname(currentPath);
    }

    // If no project marker found, return the directory of the file
    return path.dirname(filePath);
  }

  /**
   * Analyze directory structure with explicit exclude patterns
   * No hidden config files - everything is explicit via parameters
   *
   * PERFORMANCE: Uses async batching to prevent blocking on large directories.
   * Lower maxDepth (default: 3) and maxFiles (default: 1000) to avoid session hangs.
   */
  async analyzeDirectory(
    projectPath: string,
    options: {
      maxDepth?: number;
      excludePatterns?: string[];
      maxFiles?: number;
      maxDirectories?: number;
    } = {}
  ): Promise<DirectoryNode> {
    const {
      maxDepth = 3,  // LOWERED from 5 to 3 (prevents massive scans)
      excludePatterns = [],
      maxFiles = 1000,  // NEW: Limit file count to prevent bloat
      maxDirectories = 500  // NEW: Limit directory count
    } = options;

    // Check if directory exists
    try {
      const stats = await fs.stat(projectPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${projectPath}`);
      }
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        throw new Error(`Directory not found: ${projectPath}`);
      }
      throw error;
    }

    // Only use explicit patterns - no hidden config files
    const allExcludePatterns = [
      ...this.defaultIgnorePatterns,
      ...excludePatterns
    ];

    // Track counts to enforce limits
    const scanContext = {
      fileCount: 0,
      directoryCount: 0,
      maxFiles,
      maxDirectories,
      dirsScannedSinceYield: 0
    };

    return await this.scanDirectory(projectPath, projectPath, allExcludePatterns, maxDepth, 0, scanContext);
  }

  /**
   * Helper function to wrap promises with timeout
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operation: string
  ): Promise<T | null> {
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        this.logger.warn(`Operation timed out after ${timeoutMs}ms: ${operation}`);
        resolve(null);
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * Generate comprehensive project summary with timeout protection
   */
  async generateProjectSummary(
    projectPath: string,
    options: {
      includeReadme?: boolean;
      includePackageInfo?: boolean;
      includeGitInfo?: boolean;
      timeoutMs?: number;
    } = {}
  ): Promise<{
    projectPath: string;
    name?: string;
    description?: string;
    version?: string;
    readme?: string;
    packageInfo?: any;
    gitInfo?: any;
    structure?: DirectoryNode;
    _timeouts?: string[];
  }> {
    const {
      includeReadme = true,
      includePackageInfo = true,
      includeGitInfo = true,
      timeoutMs = 3000 // 3 second timeout for file operations
    } = options;

    const summary: any = {
      projectPath
    };

    const timeouts: string[] = [];

    // Try to load package.json with timeout
    if (includePackageInfo) {
      try {
        const packagePath = path.join(projectPath, 'package.json');
        const readOperation = fs.readFile(packagePath, 'utf-8');
        const packageContent = await this.withTimeout(
          readOperation,
          timeoutMs,
          `read package.json at ${packagePath}`
        );

        if (packageContent) {
          const packageJson = JSON.parse(packageContent);
          summary.name = packageJson.name;
          summary.version = packageJson.version;
          summary.description = packageJson.description;
          summary.packageInfo = packageJson;
        } else {
          timeouts.push('package.json');
        }
      } catch (error) {
        // package.json not found or invalid
        this.logger.debug(`Failed to read package.json: ${error}`);
      }
    }

    // Try to load README with timeout
    if (includeReadme) {
      const readmeFiles = ['README.md', 'readme.md', 'README.txt', 'readme.txt'];
      let readmeFound = false;

      for (const readmeFile of readmeFiles) {
        if (readmeFound) break;

        try {
          const readmePath = path.join(projectPath, readmeFile);
          const readOperation = fs.readFile(readmePath, 'utf-8');
          const readmeContent = await this.withTimeout(
            readOperation,
            timeoutMs,
            `read ${readmeFile} at ${readmePath}`
          );

          if (readmeContent) {
            summary.readme = readmeContent;
            readmeFound = true;
          } else {
            timeouts.push(readmeFile);
          }
        } catch (error) {
          // Continue to next README variant
          this.logger.debug(`Failed to read ${readmeFile}: ${error}`);
        }
      }
    }

    // Try to get git info with timeout
    if (includeGitInfo) {
      try {
        const gitPath = path.join(projectPath, '.git');
        const accessOperation = fs.access(gitPath);
        const accessResult = await this.withTimeout(
          accessOperation,
          timeoutMs,
          `access .git at ${gitPath}`
        );

        if (accessResult !== null) {
          summary.gitInfo = {
            isGitRepository: true,
            gitPath
          };
        } else {
          timeouts.push('.git');
          summary.gitInfo = {
            isGitRepository: false,
            reason: 'timeout'
          };
        }
      } catch (error) {
        summary.gitInfo = {
          isGitRepository: false,
          reason: 'not found or inaccessible'
        };
        this.logger.debug(`Failed to access .git: ${error}`);
      }
    }

    // Include timeout information if any occurred
    if (timeouts.length > 0) {
      summary._timeouts = timeouts;
      this.logger.warn(`Project summary completed with timeouts: ${timeouts.join(', ')}`);
    }

    return summary;
  }


  /**
   * Recursively scan directory with exclude patterns.
   *
   * ASYNC BATCHING: Yields control to event loop every 10 directories to prevent blocking.
   * This prevents session hangs on large directories (e.g., ZMCPTools with 3,891 files).
   */
  private async scanDirectory(
    basePath: string,
    currentPath: string,
    excludePatterns: string[],
    maxDepth: number,
    currentDepth: number,
    scanContext?: {
      fileCount: number;
      directoryCount: number;
      maxFiles: number;
      maxDirectories: number;
      dirsScannedSinceYield: number;
    }
  ): Promise<DirectoryNode> {
    const { minimatch } = await import('minimatch');
    const name = path.basename(currentPath);
    const relativePath = path.relative(basePath, currentPath);

    const node: DirectoryNode = {
      name,
      type: 'directory',
      path: currentPath,
      children: []
    };

    // Check max depth
    if (maxDepth > 0 && currentDepth >= maxDepth) {
      return node;
    }

    // Check directory count limit
    if (scanContext && scanContext.directoryCount >= scanContext.maxDirectories) {
      this.logger.warn(`Reached max directory limit (${scanContext.maxDirectories}), stopping scan`);
      return node;
    }

    // ASYNC BATCHING: Yield control every 10 directories to prevent blocking
    if (scanContext && scanContext.dirsScannedSinceYield >= 10) {
      await new Promise(resolve => setImmediate(resolve));
      scanContext.dirsScannedSinceYield = 0;
    }

    // Increment directory count
    if (scanContext) {
      scanContext.directoryCount++;
      scanContext.dirsScannedSinceYield++;
    }

    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        // Check file count limit
        if (scanContext && scanContext.fileCount >= scanContext.maxFiles) {
          this.logger.warn(`Reached max file limit (${scanContext.maxFiles}), stopping scan`);
          break;
        }

        const entryPath = path.join(currentPath, entry.name);
        const entryRelativePath = path.relative(basePath, entryPath);

        // Check if entry should be excluded
        const shouldExclude = excludePatterns.some(pattern => {
          // Handle both glob patterns and exact matches
          // Match against relative path for directory patterns like "coverage/"
          // Match against name for simple patterns like "*.log"
          const patternWithoutSlash = pattern.replace(/\/$/, '');
          return minimatch(entryRelativePath, pattern, { dot: true }) ||
                 minimatch(entry.name, pattern, { dot: true }) ||
                 entryRelativePath === patternWithoutSlash ||
                 entry.name === patternWithoutSlash;
        });

        if (shouldExclude) {
          continue;
        }

        if (entry.isDirectory()) {
          // Skip symbolic links to avoid infinite loops
          try {
            const stats = await fs.lstat(entryPath);
            if (stats.isSymbolicLink()) {
              continue;
            }
          } catch (error) {
            continue;
          }

          const childNode = await this.scanDirectory(
            basePath,
            entryPath,
            excludePatterns,
            maxDepth,
            currentDepth + 1,
            scanContext  // Pass context to track counts and yielding
          );
          node.children!.push(childNode);
        } else if (entry.isFile()) {
          // Skip symbolic links
          try {
            const stats = await fs.lstat(entryPath);
            if (stats.isSymbolicLink()) {
              continue;
            }

            const fileNode: DirectoryNode = {
              name: entry.name,
              type: 'file',
              path: entryPath,
              size: stats.size,
              lastModified: stats.mtime
            };
            node.children!.push(fileNode);

            // Increment file count
            if (scanContext) {
              scanContext.fileCount++;
            }
          } catch (error) {
            // Skip files we can't access
            continue;
          }
        }
      }
    } catch (error) {
      // Directory read error (permission denied, etc.)
      this.logger.warn(`Failed to read directory: ${currentPath}`, error);
    }

    return node;
  }

  /**
   * Shutdown the service and close database connections
   */
  async shutdown(): Promise<void> {
    await this.analysisStorage.shutdown();
  }
}