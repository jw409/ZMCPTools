/**
 * Code Acquisition Service
 * Simple service for acquiring external codebases and auto-indexing them
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../utils/logger.js';
import { RealFileIndexingService } from './RealFileIndexingService.js';

const logger = new Logger('code-acquisition');

export interface AcquisitionResult {
  success: boolean;
  localPath?: string;
  repositoryUrl?: string;
  indexingStats?: {
    totalFiles: number;
    indexedFiles: number;
    languages: Record<string, number>;
    indexingTimeMs: number;
  };
  error?: string;
}

export interface AcquisitionOptions {
  targetDirectory?: string;
  autoIndex?: boolean;
  shallow?: boolean;
  branch?: string;
}

/**
 * Service for acquiring and indexing external codebases
 */
export class CodeAcquisitionService {
  private acquisitionsDir: string;
  private fileIndexingService: RealFileIndexingService;

  constructor(baseDir: string = '/tmp/code-acquisitions') {
    this.acquisitionsDir = baseDir;
    this.fileIndexingService = new RealFileIndexingService();
  }

  /**
   * Clone a git repository and optionally index it
   */
  async acquireRepository(
    repositoryUrl: string,
    options: AcquisitionOptions = {}
  ): Promise<AcquisitionResult> {
    const {
      targetDirectory,
      autoIndex = true,
      shallow = true,
      branch = 'main'
    } = options;

    try {
      // Ensure acquisitions directory exists
      await fs.mkdir(this.acquisitionsDir, { recursive: true });

      // Generate local path
      const repoName = this.extractRepoName(repositoryUrl);
      const localPath = targetDirectory || path.join(this.acquisitionsDir, repoName);

      logger.info('Acquiring repository', { repositoryUrl, localPath });

      // Check if directory already exists
      const exists = await this.directoryExists(localPath);
      if (exists) {
        logger.info('Repository already exists, updating');
        await this.updateRepository(localPath);
      } else {
        // Clone the repository
        await this.cloneRepository(repositoryUrl, localPath, { shallow, branch });
      }

      const result: AcquisitionResult = {
        success: true,
        localPath,
        repositoryUrl
      };

      // Auto-index if requested
      if (autoIndex) {
        logger.info('Auto-indexing acquired repository');
        const indexingStats = await this.fileIndexingService.indexRepository(localPath);
        result.indexingStats = {
          totalFiles: indexingStats.totalFiles,
          indexedFiles: indexingStats.indexedFiles,
          languages: indexingStats.languages,
          indexingTimeMs: indexingStats.indexingTimeMs
        };
        logger.info('Repository indexed successfully', {
          files: indexingStats.indexedFiles,
          languages: Object.keys(indexingStats.languages).length
        });
      }

      return result;

    } catch (error) {
      logger.error('Failed to acquire repository', { repositoryUrl, error: error.message });
      return {
        success: false,
        repositoryUrl,
        error: error.message
      };
    }
  }

  /**
   * Extract repository name from URL
   */
  private extractRepoName(repositoryUrl: string): string {
    const urlParts = repositoryUrl.split('/');
    const repoWithExt = urlParts[urlParts.length - 1];
    return repoWithExt.replace(/\.git$/, '');
  }

  /**
   * Check if directory exists
   */
  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Clone repository using git
   */
  private async cloneRepository(
    repositoryUrl: string,
    localPath: string,
    options: { shallow: boolean; branch: string }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ['clone'];

      if (options.shallow) {
        args.push('--depth', '1');
      }

      args.push('--branch', options.branch);
      args.push(repositoryUrl, localPath);

      const gitProcess = spawn('git', args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      gitProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      gitProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      gitProcess.on('close', (code) => {
        if (code === 0) {
          logger.info('Repository cloned successfully', { repositoryUrl, localPath });
          resolve();
        } else {
          logger.error('Git clone failed', { repositoryUrl, stderr });
          reject(new Error(`Git clone failed: ${stderr}`));
        }
      });

      gitProcess.on('error', (error) => {
        reject(new Error(`Failed to spawn git process: ${error.message}`));
      });
    });
  }

  /**
   * Update existing repository using git pull
   */
  private async updateRepository(localPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const gitProcess = spawn('git', ['pull'], {
        cwd: localPath,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stderr = '';

      gitProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      gitProcess.on('close', (code) => {
        if (code === 0) {
          logger.info('Repository updated successfully', { localPath });
          resolve();
        } else {
          logger.warn('Git pull failed, continuing with existing code', { localPath, stderr });
          resolve(); // Don't fail the whole operation if pull fails
        }
      });

      gitProcess.on('error', (error) => {
        logger.warn('Failed to update repository, continuing with existing code', {
          localPath,
          error: error.message
        });
        resolve(); // Don't fail the whole operation
      });
    });
  }

  /**
   * List acquired repositories
   */
  async listAcquisitions(): Promise<Array<{ name: string; path: string; lastModified: Date }>> {
    try {
      const entries = await fs.readdir(this.acquisitionsDir, { withFileTypes: true });
      const repositories = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = path.join(this.acquisitionsDir, entry.name);
          const stats = await fs.stat(fullPath);
          repositories.push({
            name: entry.name,
            path: fullPath,
            lastModified: stats.mtime
          });
        }
      }

      return repositories.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    } catch (error) {
      logger.error('Failed to list acquisitions', { error: error.message });
      return [];
    }
  }

  /**
   * Remove an acquired repository
   */
  async removeAcquisition(repoName: string): Promise<boolean> {
    try {
      const fullPath = path.join(this.acquisitionsDir, repoName);
      await fs.rm(fullPath, { recursive: true, force: true });
      logger.info('Repository removed', { repoName, path: fullPath });
      return true;
    } catch (error) {
      logger.error('Failed to remove repository', { repoName, error: error.message });
      return false;
    }
  }

  /**
   * Get acquisition directory path
   */
  getAcquisitionsDirectory(): string {
    return this.acquisitionsDir;
  }
}