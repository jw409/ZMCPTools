import { z } from 'zod';
import { join } from 'path';
// REMOVED: Missing types/index.js to fix MCP server startup
// import { ToolContext } from '../types/index.js';

// Define ToolContext inline for now
interface ToolContext {
  db?: any;
  repositoryPath?: string;
}
import { ResultFinderService } from '../services/ResultFinderService.js';
import { AgentRepository } from '../repositories/AgentRepository.js';

export const getAgentResultsSchema = z.object({
  agentId: z.string().describe('The ID of the agent to get results for'),
  repositoryPath: z.string().optional().describe('Optional repository path to search in. Defaults to current working directory'),
  waitTimeoutMs: z.number().optional().default(30000).describe('Optional timeout in milliseconds to wait for results (default: 30000ms)'),
  pollingIntervalMs: z.number().optional().default(1000).describe('Optional polling interval in milliseconds when waiting (default: 1000ms)')
});

export type GetAgentResultsParams = z.infer<typeof getAgentResultsSchema>;

export async function getAgentResultsTool(
  params: GetAgentResultsParams,
  context: ToolContext
): Promise<{
  success: boolean;
  agentId: string;
  results?: any;
  artifacts?: { created: string[]; modified: string[] };
  completionMessage?: string;
  errorDetails?: any;
  foundPath?: string;
  searchPaths?: string[];
  statusSummary?: any;
  message?: string;
}> {
  const { agentId, repositoryPath = process.cwd(), waitTimeoutMs, pollingIntervalMs } = params;

  try {
    // Initialize services
    const resultFinder = new ResultFinderService(context.db);
    const agentRepository = new AgentRepository(context.db);

    // Try to find existing results first
    let findResult = await resultFinder.findResults(agentId, repositoryPath);

    // If no results found and waitTimeoutMs > 0, wait for results
    if (!findResult.results && waitTimeoutMs > 0) {
      const waitedResults = await resultFinder.waitForResults(
        agentId,
        repositoryPath,
        {
          timeoutMs: waitTimeoutMs,
          pollingIntervalMs
        }
      );

      if (waitedResults) {
        // Re-run findResults to get the full findResult object
        findResult = await resultFinder.findResults(agentId, repositoryPath);
      }
    }

    // Get database information about the agent if available
    let statusSummary;
    try {
      const agent = await agentRepository.findById(agentId);
      if (agent) {
        statusSummary = {
          agentStatus: agent.status,
          agentType: agent.agentType,
          agentName: agent.agentName,
          repositoryPath: agent.repositoryPath,
          lastHeartbeat: agent.lastHeartbeat,
          createdAt: agent.createdAt,
          hasDbResults: !!(agent.results || agent.completionMessage || agent.resultPath)
        };
      }
    } catch (error) {
      // Agent not found in database - that's okay, results might be filesystem-only
    }

    if (findResult.results) {
      return {
        success: true,
        agentId,
        results: findResult.results.results,
        artifacts: findResult.results.artifacts ? {
          created: findResult.results.artifacts.created || [],
          modified: findResult.results.artifacts.modified || []
        } : { created: [], modified: [] },
        completionMessage: findResult.results.completionMessage,
        errorDetails: findResult.results.errorDetails,
        foundPath: findResult.foundPath!,
        searchPaths: findResult.searchPaths,
        statusSummary,
        message: `Successfully retrieved results for agent ${agentId} from ${findResult.foundPath}`
      };
    } else {
      return {
        success: false,
        agentId,
        searchPaths: findResult.searchPaths,
        statusSummary,
        message: `No results found for agent ${agentId}. Searched in: ${findResult.searchPaths.join(', ')}`
      };
    }

  } catch (error) {
    return {
      success: false,
      agentId,
      message: `Error retrieving results for agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export const getAgentResultsToolSpec = {
  name: 'get_agent_results',
  description: 'Retrieve results from a completed or failed agent by ID. This tool searches for agent result files both in the local project directory and parent directories (bubbling up). Can wait for results if they are not immediately available.',
  inputSchema: getAgentResultsSchema
};