/**
 * MCP Tools for TreeSummary project analysis and caching
 * Exposes TreeSummary functionality through the MCP protocol for agent use
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  TreeSummaryService,
  type ProjectOverview,
  type FileAnalysis,
  type UpdateOptions,
} from "../services/TreeSummaryService.js";
import {
  UpdateFileAnalysisSchema,
  RemoveFileAnalysisSchema,
  UpdateProjectMetadataSchema,
  GetProjectOverviewSchema,
  CleanupStaleAnalysesSchema,
  UpdateFileAnalysisResponseSchema,
  RemoveFileAnalysisResponseSchema,
  UpdateProjectMetadataResponseSchema,
  GetProjectOverviewResponseSchema,
  CleanupStaleAnalysesResponseSchema,
} from "../schemas/tools/treeSummary.js";
import {
  createSuccessResponse,
  createErrorResponse,
  type TreeSummaryResponse,
} from "../schemas/toolResponses.js";

export class TreeSummaryTools {
  private treeSummaryService: TreeSummaryService;

  constructor() {
    this.treeSummaryService = new TreeSummaryService();
  }

  /**
   * Get all TreeSummary MCP tools
   */
  getTools() {
    return [
      {
        name: "update_file_analysis",
        description:
          "Update or create analysis data for a specific file in the TreeSummary system",
        inputSchema: zodToJsonSchema(UpdateFileAnalysisSchema),
        outputSchema: zodToJsonSchema(UpdateFileAnalysisResponseSchema),
      },
      {
        name: "remove_file_analysis",
        description:
          "Remove analysis data for a deleted file from the TreeSummary system",
        inputSchema: zodToJsonSchema(RemoveFileAnalysisSchema),
        outputSchema: zodToJsonSchema(RemoveFileAnalysisResponseSchema),
      },
      {
        name: "update_project_metadata",
        description: "Update project metadata in the TreeSummary system",
        inputSchema: zodToJsonSchema(UpdateProjectMetadataSchema),
        outputSchema: zodToJsonSchema(UpdateProjectMetadataResponseSchema),
      },
      {
        name: "get_project_overview",
        description:
          "Get comprehensive project overview from TreeSummary analysis",
        inputSchema: zodToJsonSchema(GetProjectOverviewSchema),
        outputSchema: zodToJsonSchema(GetProjectOverviewResponseSchema),
      },
      {
        name: "cleanup_stale_analyses",
        description: "Clean up stale analysis files older than specified days",
        inputSchema: zodToJsonSchema(CleanupStaleAnalysesSchema),
        outputSchema: zodToJsonSchema(CleanupStaleAnalysesResponseSchema),
      },
    ];
  }

  /**
   * Handle tool execution
   */
  async handleToolCall(name: string, args: any): Promise<TreeSummaryResponse> {
    try {
      switch (name) {
        case "update_file_analysis":
          return await this.updateFileAnalysis(args);
        case "remove_file_analysis":
          return await this.removeFileAnalysis(args);
        case "update_project_metadata":
          return await this.updateProjectMetadata(args);
        case "get_project_overview":
          return await this.getProjectOverview(args);
        case "cleanup_stale_analyses":
          return await this.cleanupStaleAnalyses(args);
        default:
          return createErrorResponse(
            `Unknown TreeSummary tool: ${name}`,
            `Tool ${name} is not implemented`,
            "UNKNOWN_TOOL"
          );
      }
    } catch (error) {
      return createErrorResponse(
        `TreeSummary tool error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.message : String(error),
        "EXECUTION_ERROR"
      );
    }
  }

  /**
   * Implementation: Update file analysis
   */
  private async updateFileAnalysis(args: any): Promise<TreeSummaryResponse> {
    const startTime = Date.now();
    const { filePath, analysisData } = args;

    try {
      // Parse date if it's a string
      if (typeof analysisData.lastModified === "string") {
        analysisData.lastModified = new Date(analysisData.lastModified);
      }

      const success = await this.treeSummaryService.updateFileAnalysis(
        filePath,
        analysisData
      );

      if (success) {
        return createSuccessResponse(
          `Successfully updated analysis for ${filePath}`,
          {
            file_path: filePath,
            analysis_updated: true,
          },
          Date.now() - startTime
        );
      } else {
        return createErrorResponse(
          `Failed to update analysis for ${filePath}`,
          "Update operation returned false",
          "UPDATE_FAILED"
        );
      }
    } catch (error) {
      return createErrorResponse(
        `Error updating analysis for ${filePath}`,
        error instanceof Error ? error.message : String(error),
        "UPDATE_ERROR"
      );
    }
  }

  /**
   * Implementation: Remove file analysis
   */
  private async removeFileAnalysis(args: any): Promise<TreeSummaryResponse> {
    const startTime = Date.now();
    const { filePath } = args;

    try {
      const success = await this.treeSummaryService.removeFileAnalysis(
        filePath
      );

      if (success) {
        return createSuccessResponse(
          `Successfully removed analysis for ${filePath}`,
          {
            file_path: filePath,
            analysis_updated: false,
          },
          Date.now() - startTime
        );
      } else {
        return createErrorResponse(
          `Failed to remove analysis for ${filePath}`,
          "Remove operation returned false",
          "REMOVE_FAILED"
        );
      }
    } catch (error) {
      return createErrorResponse(
        `Error removing analysis for ${filePath}`,
        error instanceof Error ? error.message : String(error),
        "REMOVE_ERROR"
      );
    }
  }

  /**
   * Implementation: Update project metadata
   */
  private async updateProjectMetadata(args: any): Promise<TreeSummaryResponse> {
    const startTime = Date.now();
    const { projectPath } = args;

    try {
      await this.treeSummaryService.updateProjectMetadata(projectPath);

      return createSuccessResponse(
        `Successfully updated project metadata${
          projectPath ? ` for ${projectPath}` : ""
        }`,
        {
          project_path: projectPath || process.cwd(),
          metadata_updated: true,
        },
        Date.now() - startTime
      );
    } catch (error) {
      return createErrorResponse(
        `Failed to update project metadata: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.message : String(error),
        "METADATA_UPDATE_ERROR"
      );
    }
  }

  /**
   * Implementation: Get project overview
   */
  private async getProjectOverview(args: any): Promise<TreeSummaryResponse> {
    const startTime = Date.now();
    const { projectPath } = args;

    try {
      const overview = await this.treeSummaryService.getProjectOverview(
        projectPath
      );

      return createSuccessResponse(
        `Successfully retrieved project overview${
          projectPath ? ` for ${projectPath}` : ""
        }`,
        {
          project_path: projectPath || process.cwd(),
          overview,
        },
        Date.now() - startTime
      );
    } catch (error) {
      return createErrorResponse(
        `Failed to get project overview: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.message : String(error),
        "OVERVIEW_ERROR"
      );
    }
  }

  /**
   * Implementation: Cleanup stale analyses
   */
  private async cleanupStaleAnalyses(args: any): Promise<TreeSummaryResponse> {
    const startTime = Date.now();
    const { projectPath, maxAgeDays = 30 } = args;

    try {
      const cleanedCount = await this.treeSummaryService.cleanupStaleAnalyses(
        projectPath,
        maxAgeDays
      );

      return createSuccessResponse(
        `Successfully cleaned up ${cleanedCount} stale analysis files`,
        {
          project_path: projectPath || process.cwd(),
          cleanup_count: cleanedCount,
        },
        Date.now() - startTime
      );
    } catch (error) {
      return createErrorResponse(
        `Failed to cleanup stale analyses: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.message : String(error),
        "CLEANUP_ERROR"
      );
    }
  }
}

export default TreeSummaryTools;
