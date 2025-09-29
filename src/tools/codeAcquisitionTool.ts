/**
 * Code Acquisition MCP Tool
 * Acquire external repositories and auto-index them for search
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CodeAcquisitionService } from '../services/CodeAcquisitionService.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('code-acquisition-tool');

// Schema for acquiring a repository
const AcquireRepositorySchema = z.object({
  repository_url: z.string().url().describe("Git repository URL to clone (https or ssh)"),
  target_directory: z.string().optional().describe("Optional target directory (defaults to /tmp/code-acquisitions/<repo-name>)"),
  auto_index: z.boolean().default(true).describe("Automatically index the repository after cloning for search"),
  shallow: z.boolean().default(true).describe("Perform shallow clone (faster, but no history)"),
  branch: z.string().default("main").describe("Branch to clone (defaults to 'main')")
});

// Schema for listing acquisitions
const ListAcquisitionsSchema = z.object({
  acquisitions_directory: z.string().optional().describe("Directory to list acquisitions from")
});

// Schema for removing an acquisition
const RemoveAcquisitionSchema = z.object({
  repository_name: z.string().describe("Name of the repository to remove"),
  acquisitions_directory: z.string().optional().describe("Directory to remove from")
});

/**
 * Acquire external repository and auto-index for search
 */
export const acquireRepository: Tool = {
  name: 'acquire_repository',
  description: `**Clone external repositories and automatically index them for search.**

🚀 **Quick Repository Analysis:**
- Clone any public Git repository instantly
- Automatically index all code files for immediate searching
- Support for GitHub, GitLab, and any Git-accessible repository

📁 **Smart Repository Management:**
- **Auto-indexing**: Instantly makes cloned code searchable via unified search
- **Shallow clones**: Fast cloning with --depth 1 (can be disabled)
- **Branch selection**: Clone specific branches
- **Update handling**: Automatically updates existing repositories

🔍 **Integration with Search:**
After acquisition, immediately use \`search_knowledge_graph_unified\` to:
- Find specific functions: "getUserById implementation"
- Understand architecture: "authentication flow patterns"
- Explore APIs: "REST endpoint definitions"

📝 **Usage Examples:**
\`\`\`
// Acquire a repository for analysis
{
  "repository_url": "https://github.com/user/repo.git",
  "auto_index": true,
  "shallow": true
}

// Then immediately search it
{
  "repository_path": "/tmp/code-acquisitions/repo",
  "query": "main entry point",
  "use_bm25": true,
  "use_qwen3_embeddings": true
}
\`\`\`

🎯 **Perfect for:**
- Code analysis and learning from open source projects
- Security audits and vulnerability scanning
- Architecture research and pattern discovery
- Competitive analysis and feature exploration
- Building knowledge bases from multiple repositories

Returns acquisition status, local path, and indexing statistics.`,

  inputSchema: zodToJsonSchema(AcquireRepositorySchema),

  async handler({ repository_url, target_directory, auto_index, shallow, branch }) {
    try {
      const acquisitionService = new CodeAcquisitionService();

      const result = await acquisitionService.acquireRepository(repository_url, {
        targetDirectory: target_directory,
        autoIndex: auto_index,
        shallow,
        branch
      });

      if (result.success) {
        return {
          success: true,
          message: `Repository acquired successfully${auto_index ? ' and indexed' : ''}`,
          data: {
            repository_url: result.repositoryUrl,
            local_path: result.localPath,
            auto_indexed: auto_index,
            indexing_stats: result.indexingStats,
            next_steps: auto_index ? [
              `Use search_knowledge_graph_unified with repository_path: "${result.localPath}"`,
              "Try queries like: 'main function', 'API endpoints', 'configuration files'"
            ] : [
              "Repository cloned but not indexed",
              "Enable auto_index=true for immediate search capability"
            ]
          }
        };
      } else {
        return {
          success: false,
          error: result.error || "Failed to acquire repository",
          suggestion: "Check that the repository URL is valid and accessible"
        };
      }
    } catch (error) {
      logger.error('Repository acquisition failed', { error: error.message });
      return {
        success: false,
        error: `Repository acquisition failed: ${error.message}`
      };
    }
  }
};

/**
 * List acquired repositories
 */
export const listAcquisitions: Tool = {
  name: 'list_acquisitions',
  description: `**List all acquired repositories available for search.**

Shows all repositories that have been cloned and indexed, with metadata:
- Repository name and local path
- Last modified timestamp
- Ready for immediate searching with unified search tool

Use this to see what codebases are available for analysis.`,

  inputSchema: zodToJsonSchema(ListAcquisitionsSchema),

  async handler({ acquisitions_directory }) {
    try {
      const acquisitionService = new CodeAcquisitionService(acquisitions_directory);
      const acquisitions = await acquisitionService.listAcquisitions();

      return {
        success: true,
        data: {
          total_repositories: acquisitions.length,
          acquisitions_directory: acquisitionService.getAcquisitionsDirectory(),
          repositories: acquisitions.map(repo => ({
            name: repo.name,
            path: repo.path,
            last_modified: repo.lastModified.toISOString(),
            search_ready: true
          }))
        }
      };
    } catch (error) {
      logger.error('Failed to list acquisitions', { error: error.message });
      return {
        success: false,
        error: `Failed to list acquisitions: ${error.message}`
      };
    }
  }
};

/**
 * Remove an acquired repository
 */
export const removeAcquisition: Tool = {
  name: 'remove_acquisition',
  description: `**Remove an acquired repository from local storage.**

Permanently deletes a cloned repository and its indexed data.
Use with caution - this cannot be undone!`,

  inputSchema: zodToJsonSchema(RemoveAcquisitionSchema),

  async handler({ repository_name, acquisitions_directory }) {
    try {
      const acquisitionService = new CodeAcquisitionService(acquisitions_directory);
      const success = await acquisitionService.removeAcquisition(repository_name);

      if (success) {
        return {
          success: true,
          message: `Repository '${repository_name}' removed successfully`
        };
      } else {
        return {
          success: false,
          error: `Failed to remove repository '${repository_name}'`
        };
      }
    } catch (error) {
      logger.error('Failed to remove acquisition', { error: error.message });
      return {
        success: false,
        error: `Failed to remove acquisition: ${error.message}`
      };
    }
  }
};

// Export all acquisition tools
export const codeAcquisitionTools = [
  acquireRepository,
  listAcquisitions,
  removeAcquisition
];