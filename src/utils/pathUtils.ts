import { resolve } from 'path';
import { Logger } from './logger.js';

const logger = new Logger('PathUtils');

/**
 * Utility functions for consistent path handling across the application
 */
export class PathUtils {
  
  /**
   * Resolve repository path to absolute path with validation
   */
  static resolveRepositoryPath(repositoryPath: string | undefined, context: string = 'operation'): string {
    if (!repositoryPath) {
      const error = `Repository path is required and cannot be empty or undefined for ${context}`;
      logger.error(error, { repositoryPath, context });
      throw new Error(error);
    }
    
    if (typeof repositoryPath !== 'string') {
      const error = `Repository path must be a string for ${context}, got ${typeof repositoryPath}`;
      logger.error(error, { repositoryPath, repositoryPathType: typeof repositoryPath, context });
      throw new Error(error);
    }
    
    // Resolve to absolute path
    const resolvedPath = resolve(repositoryPath);
    
    logger.debug(`Resolved repository path for ${context}`, {
      originalPath: repositoryPath,
      resolvedPath: resolvedPath,
      context
    });
    
    return resolvedPath;
  }

  /**
   * Validate and resolve working directory path
   */
  static resolveWorkingDirectory(workingDirectory: string | undefined, fallback?: string, context: string = 'operation'): string {
    let targetPath = workingDirectory;
    
    if (!targetPath || typeof targetPath !== 'string') {
      targetPath = fallback || process.cwd();
      logger.warn(`Invalid working directory for ${context}, using fallback`, {
        originalPath: workingDirectory,
        fallbackPath: targetPath,
        context
      });
    }
    
    // Resolve to absolute path
    const resolvedPath = resolve(targetPath);
    
    logger.debug(`Resolved working directory for ${context}`, {
      originalPath: workingDirectory,
      resolvedPath: resolvedPath,
      context
    });
    
    return resolvedPath;
  }

  /**
   * Validate that two repository paths are equivalent when resolved
   */
  static areRepositoryPathsEquivalent(path1: string | undefined, path2: string | undefined): boolean {
    if (!path1 && !path2) return true;
    if (!path1 || !path2) return false;
    
    try {
      const resolved1 = this.resolveRepositoryPath(path1, 'path comparison');
      const resolved2 = this.resolveRepositoryPath(path2, 'path comparison');
      return resolved1 === resolved2;
    } catch (error) {
      logger.warn('Failed to compare repository paths', {
        path1,
        path2,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Normalize repository path for consistent storage and comparison
   */
  static normalizeRepositoryPath(repositoryPath: string | undefined): string {
    return this.resolveRepositoryPath(repositoryPath, 'path normalization');
  }

  /**
   * Get relative path from repository root (for display purposes)
   */
  static getRelativeFromRepository(repositoryPath: string, targetPath: string): string {
    const resolvedRepo = this.resolveRepositoryPath(repositoryPath, 'relative path calculation');
    const resolvedTarget = resolve(targetPath);
    
    if (resolvedTarget.startsWith(resolvedRepo)) {
      const relativePath = resolvedTarget.substring(resolvedRepo.length);
      return relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
    }
    
    return resolvedTarget;
  }
}