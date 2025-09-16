import { join, dirname, resolve } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { AgentResultService } from './AgentResultService.js';
import { DatabaseManager } from '../database/index.js';
import type { AgentResults } from '../schemas/index.js';

/**
 * Service for finding agent results using bubbling search pattern
 *
 * Implements exception-like bubbling search:
 * 1. Current directory: ./var/zmcp_agent_results/{agent-id}/
 * 2. Parent directory: ../var/zmcp_agent_results/{agent-id}/
 * 3. Continue up to repository root (detected by .git)
 * 4. Last resort: ~/.mcptools/orphaned-results/{agent-id}/
 */
export class ResultFinderService {
  private resultService: AgentResultService;

  constructor(databaseManager: DatabaseManager) {
    this.resultService = new AgentResultService(databaseManager);
  }

  /**
   * Find agent results using bubbling search pattern
   */
  async findResults(agentId: string, startDir: string = process.cwd()): Promise<{
    results: AgentResults | null;
    foundPath: string | null;
    searchPaths: string[];
  }> {
    const searchPaths: string[] = [];
    let currentDir = resolve(startDir);
    let results: AgentResults | null = null;
    let foundPath: string | null = null;

    // Phase 1: Bubble up through directory tree
    for (let i = 0; i < 10; i++) { // Max 10 levels to prevent infinite loops
      const candidatePath = join(currentDir, 'var', 'zmcp_agent_results', agentId);
      searchPaths.push(candidatePath);

      if (existsSync(candidatePath)) {
        try {
          results = await this.resultService.readResults(agentId, currentDir);
          foundPath = candidatePath;
          break;
        } catch (error) {
          console.warn(`Failed to read results from ${candidatePath}:`, error);
        }
      }

      // Check if we've reached repository root
      if (existsSync(join(currentDir, '.git'))) {
        break;
      }

      // Move up one directory
      const parentDir = dirname(currentDir);
      if (parentDir === currentDir) {
        // Reached filesystem root
        break;
      }
      currentDir = parentDir;
    }

    // Phase 2: Check orphaned results as last resort
    if (!results) {
      const orphanedPath = join(homedir(), '.mcptools', 'orphaned-results', agentId);
      searchPaths.push(orphanedPath);

      if (existsSync(orphanedPath)) {
        try {
          results = await this.readOrphanedResults(agentId);
          foundPath = orphanedPath;
        } catch (error) {
          console.warn(`Failed to read orphaned results from ${orphanedPath}:`, error);
        }
      }
    }

    return {
      results,
      foundPath,
      searchPaths,
    };
  }

  /**
   * Find results with timeout for non-blocking operations
   */
  async findResultsWithTimeout(
    agentId: string,
    startDir: string = process.cwd(),
    timeoutMs: number = 5000
  ): Promise<{
    results: AgentResults | null;
    foundPath: string | null;
    searchPaths: string[];
    timedOut: boolean;
  }> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve({
          results: null,
          foundPath: null,
          searchPaths: [],
          timedOut: true,
        });
      }, timeoutMs);

      this.findResults(agentId, startDir)
        .then((result) => {
          clearTimeout(timeoutId);
          resolve({
            ...result,
            timedOut: false,
          });
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          console.error(`Error during result search for ${agentId}:`, error);
          resolve({
            results: null,
            foundPath: null,
            searchPaths: [],
            timedOut: false,
          });
        });
    });
  }

  /**
   * Wait for agent results to appear (polling)
   */
  async waitForResults(
    agentId: string,
    startDir: string = process.cwd(),
    options: {
      timeoutMs?: number;
      pollingIntervalMs?: number;
      maxAttempts?: number;
    } = {}
  ): Promise<AgentResults | null> {
    const {
      timeoutMs = 300000, // 5 minutes
      pollingIntervalMs = 2000, // 2 seconds
      maxAttempts = Math.floor(timeoutMs / pollingIntervalMs),
    } = options;

    const startTime = Date.now();
    let attempts = 0;

    while (attempts < maxAttempts && (Date.now() - startTime) < timeoutMs) {
      const { results } = await this.findResults(agentId, startDir);

      if (results) {
        return results;
      }

      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, pollingIntervalMs));
      attempts++;
    }

    return null; // Timeout reached
  }

  /**
   * Check if results exist anywhere in the bubbling hierarchy
   */
  async hasResults(agentId: string, startDir: string = process.cwd()): Promise<boolean> {
    const { results } = await this.findResults(agentId, startDir);
    return results !== null;
  }

  /**
   * Move results to orphaned location for recovery
   */
  async moveToOrphaned(agentId: string, fromPath: string): Promise<string> {
    const orphanedDir = join(homedir(), '.mcptools', 'orphaned-results');
    const targetPath = join(orphanedDir, agentId);

    try {
      // Ensure orphaned directory exists
      const { promises: fs } = await import('fs');
      await fs.mkdir(orphanedDir, { recursive: true });

      // Move the entire result directory
      await fs.rename(fromPath, targetPath);

      console.log(`📦 Moved agent results to orphaned: ${agentId}`);
      return targetPath;
    } catch (error) {
      console.error(`Failed to move results to orphaned for ${agentId}:`, error);
      throw error;
    }
  }

  /**
   * Clean up orphaned results older than specified days
   */
  async cleanupOrphanedResults(maxAgeDays: number = 30): Promise<number> {
    const orphanedDir = join(homedir(), '.mcptools', 'orphaned-results');

    if (!existsSync(orphanedDir)) {
      return 0;
    }

    try {
      const { promises: fs } = await import('fs');
      const entries = await fs.readdir(orphanedDir, { withFileTypes: true });
      const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
      let cleanedCount = 0;

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const entryPath = join(orphanedDir, entry.name);
          const stats = await fs.stat(entryPath);

          if (stats.mtime.getTime() < cutoffTime) {
            await fs.rm(entryPath, { recursive: true, force: true });
            cleanedCount++;
            console.log(`🧹 Cleaned up orphaned results: ${entry.name}`);
          }
        }
      }

      return cleanedCount;
    } catch (error) {
      console.error('Failed to cleanup orphaned results:', error);
      return 0;
    }
  }

  /**
   * Get statistics about result distribution
   */
  async getResultStats(startDir: string = process.cwd()): Promise<{
    totalAgents: number;
    foundInCurrent: number;
    foundInParents: number;
    foundInOrphaned: number;
    notFound: number;
  }> {
    // This would need to be implemented based on specific requirements
    // For now, return empty stats
    return {
      totalAgents: 0,
      foundInCurrent: 0,
      foundInParents: 0,
      foundInOrphaned: 0,
      notFound: 0,
    };
  }

  /**
   * Read orphaned results from the global location
   */
  private async readOrphanedResults(agentId: string): Promise<AgentResults> {
    const orphanedPath = join(homedir(), '.mcptools', 'orphaned-results', agentId);

    // Use the same structure as regular results but from orphaned location
    return this.resultService.readResults(agentId, join(homedir(), '.mcptools', 'orphaned-results'));
  }

  /**
   * Debug method to show search hierarchy
   */
  async debugSearchPaths(agentId: string, startDir: string = process.cwd()): Promise<void> {
    console.log(`🔍 Debug: Search paths for agent ${agentId} from ${startDir}:`);

    const { searchPaths, foundPath } = await this.findResults(agentId, startDir);

    searchPaths.forEach((path, index) => {
      const status = path === foundPath ? '✅ FOUND' : existsSync(path) ? '📁 EXISTS' : '❌ NOT FOUND';
      console.log(`  ${index + 1}. ${path} - ${status}`);
    });

    if (!foundPath) {
      console.log('  ❌ No results found in any location');
    }
  }
}