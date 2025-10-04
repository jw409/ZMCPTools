/**
 * MCP Tools for TreeSummary project analysis and caching
 * Exposes TreeSummary functionality through the MCP protocol for agent use
 */

import { z } from "zod";
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { McpTool } from '../schemas/tools/index.js';
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
   *
   * DEPRECATED: These tools are broken stubs. Use MCP Resources instead:
   * - file://{path}/symbols - Extract functions, classes, methods
   * - file://{path}/imports - Extract imports
   * - file://{path}/ast - Full AST analysis
   * - project://{path}/structure - Directory tree
   * - project://{path}/summary - Project overview
   */
  getTools(): McpTool[] {
    // Return empty array - these tools are deprecated and non-functional
    // The implementations below just return "feature removed" messages
    return [];
  }


  /**
   * Implementation: Update file analysis
   */
  private async updateFileAnalysis(args: any): Promise<TreeSummaryResponse> {
    const startTime = Date.now();
    
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      filePath: args.filePath || args.file_path,
      analysisData: args.analysisData || args.analysis_data
    };
    
    const { filePath, analysisData } = normalizedArgs;

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
    
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      filePath: args.filePath || args.file_path
    };
    
    const { filePath } = normalizedArgs;

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
    
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      projectPath: args.projectPath || args.project_path
    };
    
    const { projectPath } = normalizedArgs;

    try {
      // TreeSummaryService.updateProjectMetadata removed in refactoring
      // Metadata is now handled automatically via SQLite storage when files are analyzed
      return createSuccessResponse(
        `Project metadata feature removed - metadata now managed automatically via file analysis`,
        {
          project_path: projectPath || process.cwd(),
          metadata_updated: false,
          note: "Metadata updates are now automatic when using updateFileAnalysis"
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
    
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      projectPath: args.projectPath || args.project_path
    };
    
    const { projectPath } = normalizedArgs;

    try {
      // TreeSummaryService.getProjectOverview removed in refactoring
      // Use analyze_project_structure or generate_project_summary instead
      return createSuccessResponse(
        `Project overview feature removed - use analyze_project_structure or generate_project_summary instead`,
        {
          project_path: projectPath || process.cwd(),
          overview: null,
          note: "Use analyze_project_structure for directory tree or generate_project_summary for comprehensive analysis"
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
    
    // Map snake_case to camelCase for compatibility
    const normalizedArgs = {
      projectPath: args.projectPath || args.project_path,
      maxAgeDays: args.maxAgeDays || args.max_age_days || 30
    };
    
    const { projectPath, maxAgeDays } = normalizedArgs;

    try {
      // TreeSummaryService.cleanupStaleAnalyses removed in refactoring
      // Analysis data is now managed in SQLite with automatic cleanup
      return createSuccessResponse(
        `Cleanup feature removed - analysis data now managed automatically in SQLite`,
        {
          project_path: projectPath || process.cwd(),
          cleanup_count: 0,
          note: "SQLite-based storage has automatic cleanup mechanisms"
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
