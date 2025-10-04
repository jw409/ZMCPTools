import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { DatabaseManager } from '../database/index.js';
import { AgentRepository } from '../repositories/index.js';
import type { AgentResults, AgentArtifacts } from '../schemas/index.js';

/**
 * Service for managing agent result collection and storage
 *
 * Features:
 * - Writes results to project-local filesystem (var/zmcp_agent_results/)
 * - Updates database with result pointers
 * - Handles both structured data and human-readable summaries
 * - Supports error collection and recovery
 */
export class AgentResultService {
  private agentRepository: AgentRepository;

  constructor(databaseManager: DatabaseManager) {
    this.agentRepository = new AgentRepository(databaseManager);
  }

  /**
   * Write complete results for an agent
   */
  async writeResults(
    agentId: string,
    results: AgentResults,
    repositoryPath: string = process.cwd()
  ): Promise<void> {
    try {
      // Create result directory structure
      const resultDir = join(repositoryPath, 'var', 'zmcp_agent_results', agentId);
      await this.ensureDirectory(resultDir);

      // Write individual result files
      await this.writeResultFiles(resultDir, results);

      // Update database with result path (only if agent exists)
      const relativePath = join('var', 'zmcp_agent_results', agentId);
      try {
        await this.agentRepository.update(agentId, {
          results: results.results,
          artifacts: results.artifacts ? {
            created: results.artifacts.created || [],
            modified: results.artifacts.modified || []
          } : undefined,
          completionMessage: results.completionMessage,
          errorDetails: results.errorDetails,
          resultPath: relativePath,
          status: results.errorDetails ? 'failed' : 'completed',
          lastHeartbeat: new Date().toISOString(),
        });
      } catch (error) {
        // If agent doesn't exist in database, that's okay - just log it
        console.warn(`Agent ${agentId} not found in database, results written to filesystem only`);
      }

      console.log(`✅ Results written for agent ${agentId} in ${relativePath}`);
    } catch (error) {
      console.error(`❌ Failed to write results for agent ${agentId}:`, error);
      throw error;
    }
  }

  /**
   * Write individual result files to the result directory
   */
  private async writeResultFiles(resultDir: string, results: AgentResults): Promise<void> {
    const tasks: Promise<void>[] = [];

    // Write status.json
    const status = {
      status: results.errorDetails ? 'failed' : 'completed',
      timestamp: new Date().toISOString(),
      hasResults: !!results.results,
      hasArtifacts: !!results.artifacts,
      hasErrors: !!results.errorDetails,
    };
    tasks.push(this.writeJsonFile(join(resultDir, 'status.json'), status));

    // Write results.json if we have results
    if (results.results) {
      tasks.push(this.writeJsonFile(join(resultDir, 'results.json'), results.results));
    }

    // Write artifacts.json if we have artifacts
    if (results.artifacts) {
      tasks.push(this.writeJsonFile(join(resultDir, 'artifacts.json'), results.artifacts));
    }

    // Write completion.txt if we have a completion message
    if (results.completionMessage) {
      tasks.push(fs.writeFile(join(resultDir, 'completion.txt'), results.completionMessage, 'utf8'));
    }

    // Write errors.json if we have error details
    if (results.errorDetails) {
      tasks.push(this.writeJsonFile(join(resultDir, 'errors.json'), results.errorDetails));
    }

    // Execute all writes in parallel
    await Promise.all(tasks);
  }

  /**
   * Write agent completion with minimal data
   */
  async writeCompletion(
    agentId: string,
    message: string,
    results: Record<string, any> = {},
    repositoryPath: string = process.cwd()
  ): Promise<void> {
    await this.writeResults(agentId, {
      results,
      completionMessage: message,
    }, repositoryPath);
  }

  /**
   * Write agent error with details
   */
  async writeError(
    agentId: string,
    error: Error | string,
    context: Record<string, any> = {},
    repositoryPath: string = process.cwd()
  ): Promise<void> {
    const errorDetails = {
      error: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context,
      timestamp: new Date().toISOString(),
    };

    await this.writeResults(agentId, {
      errorDetails,
      completionMessage: `Task failed: ${errorDetails.message}`,
    }, repositoryPath);
  }

  /**
   * Write agent artifacts (files created/modified)
   */
  async writeArtifacts(
    agentId: string,
    artifacts: AgentArtifacts,
    repositoryPath: string = process.cwd()
  ): Promise<void> {
    // Read existing results if any
    const existingResults = await this.readResults(agentId, repositoryPath);

    await this.writeResults(agentId, {
      ...existingResults,
      artifacts,
    }, repositoryPath);
  }

  /**
   * Read results from filesystem
   */
  async readResults(agentId: string, repositoryPath: string = process.cwd()): Promise<AgentResults> {
    const resultDir = join(repositoryPath, 'var', 'zmcp_agent_results', agentId);

    if (!existsSync(resultDir)) {
      return {};
    }

    const results: AgentResults = {};

    try {
      // Read results.json
      const resultsPath = join(resultDir, 'results.json');
      if (existsSync(resultsPath)) {
        const content = await fs.readFile(resultsPath, 'utf8');
        results.results = JSON.parse(content);
      }

      // Read artifacts.json
      const artifactsPath = join(resultDir, 'artifacts.json');
      if (existsSync(artifactsPath)) {
        const content = await fs.readFile(artifactsPath, 'utf8');
        results.artifacts = JSON.parse(content);
      }

      // Read completion.txt
      const completionPath = join(resultDir, 'completion.txt');
      if (existsSync(completionPath)) {
        results.completionMessage = await fs.readFile(completionPath, 'utf8');
      }

      // Read errors.json
      const errorsPath = join(resultDir, 'errors.json');
      if (existsSync(errorsPath)) {
        const content = await fs.readFile(errorsPath, 'utf8');
        results.errorDetails = JSON.parse(content);
      }

      return results;
    } catch (error) {
      console.error(`Failed to read results for agent ${agentId}:`, error);
      return {};
    }
  }

  /**
   * Check if agent has results
   */
  async hasResults(agentId: string, repositoryPath: string = process.cwd()): Promise<boolean> {
    const resultDir = join(repositoryPath, 'var', 'zmcp_agent_results', agentId);
    return existsSync(resultDir);
  }

  /**
   * Clean up old results (for testing/maintenance)
   */
  async cleanupResults(agentId: string, repositoryPath: string = process.cwd()): Promise<void> {
    const resultDir = join(repositoryPath, 'var', 'zmcp_agent_results', agentId);

    if (existsSync(resultDir)) {
      await fs.rm(resultDir, { recursive: true, force: true });
      console.log(`🧹 Cleaned up results for agent ${agentId}`);
    }
  }

  /**
   * Utility method to write JSON files
   */
  private async writeJsonFile(filePath: string, data: any): Promise<void> {
    const content = JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, content, 'utf8');
  }

  /**
   * Utility method to ensure directory exists
   */
  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Generate human-readable summary of results
   */
  generateSummary(results: AgentResults): string {
    const parts: string[] = [];

    if (results.artifacts) {
      const { created, modified } = results.artifacts;
      if (created.length > 0) {
        parts.push(`Created ${created.length} files`);
      }
      if (modified.length > 0) {
        parts.push(`Modified ${modified.length} files`);
      }
    }

    if (results.results) {
      const metrics = Object.keys(results.results).length;
      if (metrics > 0) {
        parts.push(`Collected ${metrics} metrics`);
      }
    }

    if (results.errorDetails) {
      parts.push(`Encountered errors`);
    }

    if (parts.length === 0) {
      return 'Task completed with no measurable artifacts';
    }

    return parts.join('; ');
  }
}