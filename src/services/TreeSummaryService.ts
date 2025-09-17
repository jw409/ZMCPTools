import * as fs from 'fs/promises';
import { accessSync } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { FoundationCacheService } from './FoundationCacheService.js';
import { AnalysisStorageService, FileAnalysisData } from './AnalysisStorageService.js';
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
   * Shutdown the service and close database connections
   */
  async shutdown(): Promise<void> {
    await this.analysisStorage.shutdown();
  }
}