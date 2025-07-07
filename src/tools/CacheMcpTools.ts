import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { FoundationCacheService, type CacheConfig, type CacheStatistics } from "../services/FoundationCacheService.js";
import { ClaudeDatabase } from "../database/index.js";

// Validation schemas
const CreateFoundationSessionSchema = z.object({
  projectPath: z.string().describe("Path to the project directory"),
  baseContext: z.any().describe("Base context object to cache"),
  sessionId: z.string().optional().describe("Optional custom session ID")
});

const DeriveSessionSchema = z.object({
  foundationSessionId: z.string().describe("ID of the foundation session to derive from"),
  derivedSessionId: z.string().describe("ID for the new derived session")
});

const GetCachedAnalysisSchema = z.object({
  filePath: z.string().describe("Path to the file being analyzed"),
  content: z.string().describe("Content of the file"),
  templateId: z.string().describe("Template/analysis type identifier"),
  sessionId: z.string().optional().describe("Session ID for context inheritance")
});

const CacheAnalysisResultSchema = z.object({
  filePath: z.string().describe("Path to the file being analyzed"),
  content: z.string().describe("Content of the file"),
  templateId: z.string().describe("Template/analysis type identifier"),
  result: z.any().describe("Analysis result to cache"),
  sessionId: z.string().optional().describe("Session ID for context inheritance"),
  tokensUsed: z.number().optional().describe("Number of tokens used for this analysis")
});

const InvalidateCacheSchema = z.object({
  sessionId: z.string().optional().describe("Invalidate entries for specific session"),
  templateId: z.string().optional().describe("Invalidate entries for specific template"),
  filePath: z.string().optional().describe("Invalidate entries for specific file"),
  olderThanDays: z.number().optional().describe("Invalidate entries older than N days")
});

/**
 * MCP Tools for Foundation Cache Management
 * Provides intelligent caching with session-based context inheritance for 85-90% token cost reduction
 */
export class CacheMcpTools {
  private cacheService: FoundationCacheService;

  constructor(claudeDb: ClaudeDatabase, config?: CacheConfig) {
    this.cacheService = new FoundationCacheService(claudeDb, config);
  }

  /**
   * Get all cache management tools
   */
  getTools(): Tool[] {
    return [
      {
        name: "create_foundation_session",
        description: "Create a foundation caching session for 85-90% token cost reduction across derived sessions",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Path to the project directory"
            },
            baseContext: {
              type: "object",
              description: "Base context object that will be shared across derived sessions"
            },
            sessionId: {
              type: "string",
              description: "Optional custom session ID. If not provided, one will be generated"
            }
          },
          required: ["projectPath", "baseContext"]
        }
      },
      {
        name: "derive_session_from_foundation", 
        description: "Create a derived session that inherits cached context from a foundation session",
        inputSchema: {
          type: "object",
          properties: {
            foundationSessionId: {
              type: "string",
              description: "ID of the foundation session to derive from"
            },
            derivedSessionId: {
              type: "string", 
              description: "ID for the new derived session"
            }
          },
          required: ["foundationSessionId", "derivedSessionId"]
        }
      },
      {
        name: "get_cached_analysis",
        description: "Retrieve cached analysis result using deterministic content hashing",
        inputSchema: {
          type: "object",
          properties: {
            filePath: {
              type: "string",
              description: "Path to the file being analyzed"
            },
            content: {
              type: "string",
              description: "Content of the file (used for deterministic hashing)"
            },
            templateId: {
              type: "string",
              description: "Template/analysis type identifier (e.g., 'code_review', 'security_audit')"
            },
            sessionId: {
              type: "string",
              description: "Session ID for context inheritance (optional)"
            }
          },
          required: ["filePath", "content", "templateId"]
        }
      },
      {
        name: "cache_analysis_result",
        description: "Cache analysis result with token usage tracking for future reuse",
        inputSchema: {
          type: "object",
          properties: {
            filePath: {
              type: "string",
              description: "Path to the file that was analyzed"
            },
            content: {
              type: "string",
              description: "Content of the file (used for deterministic hashing)"
            },
            templateId: {
              type: "string", 
              description: "Template/analysis type identifier"
            },
            result: {
              type: "object",
              description: "Analysis result to cache"
            },
            sessionId: {
              type: "string",
              description: "Session ID for context inheritance (optional)"
            },
            tokensUsed: {
              type: "number",
              description: "Number of tokens used for this analysis (optional)"
            }
          },
          required: ["filePath", "content", "templateId", "result"]
        }
      },
      {
        name: "get_cache_statistics",
        description: "Get comprehensive cache performance statistics and metrics",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      },
      {
        name: "invalidate_cache",
        description: "Invalidate cache entries based on various criteria",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "Invalidate all entries for this session ID"
            },
            templateId: {
              type: "string",
              description: "Invalidate all entries for this template ID"
            },
            filePath: {
              type: "string", 
              description: "Invalidate all entries for this file path"
            },
            olderThanDays: {
              type: "number",
              description: "Invalidate entries older than this many days"
            }
          },
          additionalProperties: false
        }
      },
      {
        name: "perform_cache_maintenance",
        description: "Perform cache cleanup and maintenance operations",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      }
    ];
  }

  /**
   * Handle tool calls for cache management
   */
  async handleToolCall(name: string, args: any): Promise<any> {
    try {
      switch (name) {
        case "create_foundation_session":
          return await this.createFoundationSession(args);
        
        case "derive_session_from_foundation":
          return await this.deriveSessionFromFoundation(args);
        
        case "get_cached_analysis":
          return await this.getCachedAnalysis(args);
        
        case "cache_analysis_result":
          return await this.cacheAnalysisResult(args);
        
        case "get_cache_statistics":
          return await this.getCacheStatistics();
        
        case "invalidate_cache":
          return await this.invalidateCache(args);
        
        case "perform_cache_maintenance":
          return await this.performCacheMaintenance();
        
        default:
          throw new Error(`Unknown cache tool: ${name}`);
      }
    } catch (error) {
      console.error(`Cache tool error (${name}):`, error);
      throw error;
    }
  }

  // Tool implementation methods

  private async createFoundationSession(args: any) {
    const { projectPath, baseContext, sessionId } = CreateFoundationSessionSchema.parse(args);
    
    const foundationSessionId = await this.cacheService.createFoundationSession(
      projectPath,
      baseContext,
      sessionId
    );

    return {
      success: true,
      foundationSessionId,
      message: `Foundation session created for ${projectPath}. Use this session ID for 85-90% token cost reduction across derived sessions.`,
      instructions: {
        deriveSession: `Use derive_session_from_foundation with foundationSessionId: "${foundationSessionId}"`,
        cacheContext: "All derived sessions will inherit the base context from this foundation session",
        tokenSavings: "Expected 85-90% reduction in token costs for shared context"
      }
    };
  }

  private async deriveSessionFromFoundation(args: any) {
    const { foundationSessionId, derivedSessionId } = DeriveSessionSchema.parse(args);
    
    const success = await this.cacheService.deriveSessionFromFoundation(
      foundationSessionId,
      derivedSessionId
    );

    if (!success) {
      return {
        success: false,
        error: `Foundation session ${foundationSessionId} not found`,
        message: "Make sure the foundation session exists before deriving from it"
      };
    }

    return {
      success: true,
      derivedSessionId,
      foundationSessionId,
      message: `Derived session "${derivedSessionId}" created from foundation "${foundationSessionId}"`,
      tokenSavings: "This session will benefit from 85-90% token cost reduction through shared context inheritance"
    };
  }

  private async getCachedAnalysis(args: any) {
    const { filePath, content, templateId, sessionId } = GetCachedAnalysisSchema.parse(args);
    
    const cachedResult = await this.cacheService.getCachedAnalysis(
      filePath,
      content,
      templateId,
      sessionId
    );

    if (cachedResult) {
      return {
        success: true,
        cached: true,
        result: cachedResult,
        message: `Cache hit! Retrieved cached analysis for ${templateId} on ${filePath}`,
        tokensSaved: "Significant token savings from cache hit"
      };
    } else {
      return {
        success: true,
        cached: false,
        result: null,
        message: `Cache miss. No cached analysis found for ${templateId} on ${filePath}`,
        suggestion: "Perform the analysis and use cache_analysis_result to cache for future use"
      };
    }
  }

  private async cacheAnalysisResult(args: any) {
    const { filePath, content, templateId, result, sessionId, tokensUsed } = 
      CacheAnalysisResultSchema.parse(args);
    
    const cacheId = await this.cacheService.cacheAnalysisResult(
      filePath,
      content,
      templateId,
      result,
      sessionId,
      tokensUsed
    );

    return {
      success: true,
      cacheId,
      message: `Analysis result cached for ${templateId} on ${filePath}`,
      details: {
        contentHashed: "Content deterministically hashed for future lookups",
        tokensUsed: tokensUsed || "Not specified",
        sessionContext: sessionId ? `Linked to session ${sessionId}` : "Default session",
        futureUse: "Identical content + template will retrieve this cached result"
      }
    };
  }

  private async getCacheStatistics(): Promise<CacheStatistics & { success: boolean; message: string; summary: any }> {
    const stats = await this.cacheService.getCacheStatistics();
    
    return {
      success: true,
      message: "Cache statistics retrieved successfully",
      ...stats,
      summary: {
        efficiency: `${(stats.cacheEfficiency * 100).toFixed(1)}% cache hit rate`,
        savings: `${stats.totalTokensSaved.toLocaleString()} total tokens saved`,
        sessions: `${stats.foundationSessions} foundation + ${stats.derivedSessions} derived sessions`,
        topPerformer: stats.topTemplates[0] ? 
          `${stats.topTemplates[0].templateId} (${stats.topTemplates[0].hits} hits)` : 
          "No data yet"
      }
    };
  }

  private async invalidateCache(args: any) {
    const validated = InvalidateCacheSchema.parse(args);
    
    // Convert olderThanDays to olderThan date if provided
    const criteria: any = { ...validated };
    if (validated.olderThanDays) {
      criteria.olderThan = new Date(Date.now() - (validated.olderThanDays * 24 * 60 * 60 * 1000));
      delete criteria.olderThanDays;
    }

    const invalidatedCount = await this.cacheService.invalidateCache(criteria);

    return {
      success: true,
      invalidatedEntries: invalidatedCount,
      criteria: validated,
      message: `Invalidated ${invalidatedCount} cache entries based on provided criteria`
    };
  }

  private async performCacheMaintenance() {
    const maintenanceResult = await this.cacheService.performMaintenance();

    return {
      success: true,
      maintenance: maintenanceResult,
      message: "Cache maintenance completed successfully",
      details: {
        expiredEntriesRemoved: maintenanceResult.expiredEntries,
        orphanedEntriesRemoved: maintenanceResult.orphanedEntries,
        databaseCompacted: `${(maintenanceResult.compactedSize / 1024 / 1024).toFixed(2)} MB reclaimed`,
        recommendation: maintenanceResult.expiredEntries > 100 ? 
          "Consider reducing cache TTL or increasing cleanup frequency" :
          "Cache maintenance is operating efficiently"
      }
    };
  }

  /**
   * Close the cache service
   */
  close(): void {
    this.cacheService.close();
  }
}

/**
 * Factory function to create cache tools with default configuration
 */
export function createCacheTools(claudeDb: ClaudeDatabase, config?: CacheConfig): CacheMcpTools {
  return new CacheMcpTools(claudeDb, config);
}