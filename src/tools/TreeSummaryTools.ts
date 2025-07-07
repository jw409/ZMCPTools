/**
 * MCP Tools for TreeSummary project analysis and caching
 * Exposes TreeSummary functionality through the MCP protocol for agent use
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { TreeSummaryService, type ProjectOverview, type FileAnalysis, type UpdateOptions } from '../services/TreeSummaryService.js';

export interface TreeSummaryResult {
  success: boolean;
  message: string;
  data?: any;
}

export class TreeSummaryTools {
  private treeSummaryService: TreeSummaryService;

  constructor() {
    this.treeSummaryService = new TreeSummaryService();
  }

  /**
   * Get all TreeSummary MCP tools
   */
  getTools(): Tool[] {
    return [
      this.getUpdateFileAnalysisTool(),
      this.getRemoveFileAnalysisTool(),
      this.getUpdateProjectMetadataTool(),
      this.getProjectOverviewTool(),
      this.getCleanupStaleAnalysesTool()
    ];
  }

  /**
   * Handle tool execution
   */
  async handleToolCall(name: string, args: any): Promise<TreeSummaryResult> {
    try {
      switch (name) {
        case 'update_file_analysis':
          return await this.updateFileAnalysis(args);
        case 'remove_file_analysis':
          return await this.removeFileAnalysis(args);
        case 'update_project_metadata':
          return await this.updateProjectMetadata(args);
        case 'get_project_overview':
          return await this.getProjectOverview(args);
        case 'cleanup_stale_analyses':
          return await this.cleanupStaleAnalyses(args);
        default:
          return {
            success: false,
            message: `Unknown TreeSummary tool: ${name}`
          };
      }
    } catch (error) {
      return {
        success: false,
        message: `TreeSummary tool error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Update file analysis tool
   */
  private getUpdateFileAnalysisTool(): Tool {
    return {
      name: 'update_file_analysis',
      description: 'Update or create analysis data for a specific file in the TreeSummary system',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Absolute path to the file to analyze'
          },
          analysisData: {
            type: 'object',
            description: 'File analysis data containing symbols, imports, exports, etc.',
            properties: {
              filePath: { type: 'string' },
              hash: { type: 'string' },
              lastModified: { type: 'string' },
              symbols: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    type: { type: 'string', enum: ['function', 'class', 'variable', 'interface', 'type', 'enum'] },
                    line: { type: 'number' },
                    column: { type: 'number' },
                    accessibility: { type: 'string', enum: ['public', 'private', 'protected'] },
                    isExported: { type: 'boolean' }
                  },
                  required: ['name', 'type', 'line', 'column', 'isExported']
                }
              },
              imports: { type: 'array', items: { type: 'string' } },
              exports: { type: 'array', items: { type: 'string' } },
              size: { type: 'number' },
              language: { type: 'string' }
            },
            required: ['filePath', 'hash', 'lastModified', 'symbols', 'imports', 'exports', 'size', 'language']
          }
        },
        required: ['filePath', 'analysisData']
      }
    };
  }

  /**
   * Remove file analysis tool
   */
  private getRemoveFileAnalysisTool(): Tool {
    return {
      name: 'remove_file_analysis',
      description: 'Remove analysis data for a deleted file from the TreeSummary system',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Absolute path to the file to remove from analysis'
          }
        },
        required: ['filePath']
      }
    };
  }

  /**
   * Update project metadata tool
   */
  private getUpdateProjectMetadataTool(): Tool {
    return {
      name: 'update_project_metadata',
      description: 'Update project metadata in the TreeSummary system',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: {
            type: 'string',
            description: 'Path to the project root (optional, defaults to current directory)'
          }
        }
      }
    };
  }

  /**
   * Get project overview tool
   */
  private getProjectOverviewTool(): Tool {
    return {
      name: 'get_project_overview',
      description: 'Get comprehensive project overview from TreeSummary analysis',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: {
            type: 'string',
            description: 'Path to the project root (optional, defaults to current directory)'
          }
        }
      }
    };
  }

  /**
   * Cleanup stale analyses tool
   */
  private getCleanupStaleAnalysesTool(): Tool {
    return {
      name: 'cleanup_stale_analyses',
      description: 'Clean up stale analysis files older than specified days',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: {
            type: 'string',
            description: 'Path to the project root (optional, defaults to current directory)'
          },
          maxAgeDays: {
            type: 'number',
            description: 'Maximum age in days for analysis files (default: 30)',
            minimum: 1,
            maximum: 365
          }
        }
      }
    };
  }

  /**
   * Implementation: Update file analysis
   */
  private async updateFileAnalysis(args: any): Promise<TreeSummaryResult> {
    const { filePath, analysisData } = args;
    
    // Parse date if it's a string
    if (typeof analysisData.lastModified === 'string') {
      analysisData.lastModified = new Date(analysisData.lastModified);
    }
    
    const success = await this.treeSummaryService.updateFileAnalysis(filePath, analysisData);
    
    return {
      success,
      message: success 
        ? `Successfully updated analysis for ${filePath}`
        : `Failed to update analysis for ${filePath}`,
      data: { filePath, updated: success }
    };
  }

  /**
   * Implementation: Remove file analysis
   */
  private async removeFileAnalysis(args: any): Promise<TreeSummaryResult> {
    const { filePath } = args;
    
    const success = await this.treeSummaryService.removeFileAnalysis(filePath);
    
    return {
      success,
      message: success 
        ? `Successfully removed analysis for ${filePath}`
        : `Failed to remove analysis for ${filePath}`,
      data: { filePath, removed: success }
    };
  }

  /**
   * Implementation: Update project metadata
   */
  private async updateProjectMetadata(args: any): Promise<TreeSummaryResult> {
    const { projectPath } = args;
    
    try {
      await this.treeSummaryService.updateProjectMetadata(projectPath);
      
      return {
        success: true,
        message: `Successfully updated project metadata${projectPath ? ` for ${projectPath}` : ''}`,
        data: { projectPath: projectPath || process.cwd() }
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to update project metadata: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Implementation: Get project overview
   */
  private async getProjectOverview(args: any): Promise<TreeSummaryResult> {
    const { projectPath } = args;
    
    try {
      const overview = await this.treeSummaryService.getProjectOverview(projectPath);
      
      return {
        success: true,
        message: `Successfully retrieved project overview${projectPath ? ` for ${projectPath}` : ''}`,
        data: overview
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to get project overview: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Implementation: Cleanup stale analyses
   */
  private async cleanupStaleAnalyses(args: any): Promise<TreeSummaryResult> {
    const { projectPath, maxAgeDays = 30 } = args;
    
    try {
      const cleanedCount = await this.treeSummaryService.cleanupStaleAnalyses(projectPath, maxAgeDays);
      
      return {
        success: true,
        message: `Successfully cleaned up ${cleanedCount} stale analysis files`,
        data: { 
          projectPath: projectPath || process.cwd(),
          cleanedCount,
          maxAgeDays
        }
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to cleanup stale analyses: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

export default TreeSummaryTools;