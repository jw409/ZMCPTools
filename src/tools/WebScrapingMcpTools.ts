/**
 * MCP Tools for web scraping and documentation intelligence
 * Exposes sub-agent based scraping functionality through MCP protocol
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { McpTool } from '../schemas/tools/index.js';
import { createHash } from 'crypto';
import type { WebScrapingService } from '../services/WebScrapingService.js';
import type { KnowledgeGraphService } from '../services/KnowledgeGraphService.js';
import { MemoryService } from '../services/MemoryService.js';
import { PatternMatcher, type ScrapingPattern, type StringPattern, type PathPattern, type VersionPattern } from '../utils/patternMatcher.js';
import { ScrapingOptimizer } from '../utils/scrapingOptimizer.js';
import { createSuccessResponse, createErrorResponse, type WebScrapingResponse } from '../schemas/toolResponses.js';
import {
  ScrapeDocumentationSchema,
  GetScrapingStatusSchema,
  CancelScrapeJobSchema,
  ForceUnlockJobSchema,
  ForceUnlockStuckJobsSchema,
  ListDocumentationSourcesSchema,
  DeletePagesByPatternSchema,
  DeletePagesByIdsSchema,
  DeleteAllWebsitePagesSchema,
  ScrapeDocumentationResponseSchema,
  GetScrapingStatusResponseSchema,
  CancelScrapeJobResponseSchema,
  ForceUnlockJobResponseSchema,
  ForceUnlockStuckJobsResponseSchema,
  ListDocumentationSourcesResponseSchema,
  DeletePagesByPatternResponseSchema,
  DeletePagesByIdsResponseSchema,
  DeleteAllWebsitePagesResponseSchema
} from '../schemas/tools/webScraping.js';

// Pattern validation function
const validatePatternArray = (patterns: (string | ScrapingPattern)[]): boolean => {
  return patterns.every(pattern => {
    if (typeof pattern === 'string') {
      return PatternMatcher.validatePattern(pattern).valid;
    }
    // For JSON patterns, we assume they're valid if they're objects
    // The PatternMatcher will handle validation during matching
    return typeof pattern === 'object' && pattern !== null;
  });
};

// Schemas imported from external file - see ../schemas/tools/webScraping.ts

// Helper function to map snake_case parameters to camelCase
function mapSnakeCaseToCamelCase(params: any): any {
  if (!params || typeof params !== 'object') {
    return params;
  }
  
  const mapped: any = {};
  
  // Direct mapping for common snake_case -> camelCase patterns
  const mappings: Record<string, string> = {
    repository_path: 'repositoryPath',
    source_type: 'sourceType',
    max_pages: 'maxPages',
    crawl_depth: 'crawlDepth',
    follow_external: 'followExternal',
    site_map_url: 'siteMapUrl',
    job_id: 'jobId',
    page_pattern: 'pagePattern',
    page_ids: 'pageIds',
    source_id: 'sourceId',
    website_id: 'websiteId',
    url_patterns: 'urlPatterns',
    dry_run: 'dryRun',
    include_stats: 'includeStats',
    include_job_details: 'includeJobDetails',
    stuck_threshold_minutes: 'stuckThresholdMinutes',
    agent_id: 'agentId',
    include_subdomains: 'includeSubdomains',
    force_refresh: 'forceRefresh',
    enable_sampling: 'enableSampling',
    sampling_timeout: 'samplingTimeout',
    allow_patterns: 'allowPatterns',
    ignore_patterns: 'ignorePatterns',
    allow_path_segments: 'allowPathSegments',
    ignore_path_segments: 'ignorePathSegments',
    allow_file_extensions: 'allowFileExtensions',
    ignore_file_extensions: 'ignoreFileExtensions',
    allow_url_contains: 'allowUrlContains',
    ignore_url_contains: 'ignoreUrlContains',
    allow_url_starts_with: 'allowUrlStartsWith',
    ignore_url_starts_with: 'ignoreUrlStartsWith',
    allow_version_patterns: 'allowVersionPatterns',
    ignore_version_patterns: 'ignoreVersionPatterns',
    allow_glob_patterns: 'allowGlobPatterns',
    ignore_glob_patterns: 'ignoreGlobPatterns',
    allow_regex_patterns: 'allowRegexPatterns',
    ignore_regex_patterns: 'ignoreRegexPatterns'
  };
  
  // Copy all properties, mapping snake_case to camelCase where needed
  for (const [key, value] of Object.entries(params)) {
    const mappedKey = mappings[key] || key;
    mapped[mappedKey] = value;
    
    // Also keep the original snake_case key for backward compatibility
    if (mappings[key]) {
      mapped[key] = value;
    }
  }
  
  return mapped;
}

// Convert typed parameters to internal ScrapingPattern format
function convertTypedParametersToPatterns(params: any): {
  allowPatterns: (string | ScrapingPattern)[];
  ignorePatterns: (string | ScrapingPattern)[];
} {
  const allowPatterns: (string | ScrapingPattern)[] = [];
  const ignorePatterns: (string | ScrapingPattern)[] = [];
  
  // Add legacy patterns first
  if (params.allow_patterns) {
    allowPatterns.push(...params.allow_patterns);
  }
  if (params.ignore_patterns) {
    ignorePatterns.push(...params.ignore_patterns);
  }
  
  // Convert typed parameters to patterns
  
  // Path segments
  if (params.allow_path_segments) {
    allowPatterns.push(...params.allow_path_segments.map((segment: string) => ({ 
      path_segment: segment 
    } as PathPattern)));
  }
  if (params.ignore_path_segments) {
    ignorePatterns.push(...params.ignore_path_segments.map((segment: string) => ({ 
      path_segment: segment 
    } as PathPattern)));
  }
  
  // File extensions
  if (params.allow_file_extensions) {
    allowPatterns.push({ extension: params.allow_file_extensions } as PathPattern);
  }
  if (params.ignore_file_extensions) {
    ignorePatterns.push({ extension: params.ignore_file_extensions } as PathPattern);
  }
  
  // URL contains
  if (params.allow_url_contains) {
    allowPatterns.push(...params.allow_url_contains.map((substring: string) => ({ 
      contains: substring 
    } as StringPattern)));
  }
  if (params.ignore_url_contains) {
    ignorePatterns.push(...params.ignore_url_contains.map((substring: string) => ({ 
      contains: substring 
    } as StringPattern)));
  }
  
  // URL starts with
  if (params.allow_url_starts_with) {
    allowPatterns.push(...params.allow_url_starts_with.map((prefix: string) => ({ 
      startsWith: prefix 
    } as StringPattern)));
  }
  if (params.ignore_url_starts_with) {
    ignorePatterns.push(...params.ignore_url_starts_with.map((prefix: string) => ({ 
      startsWith: prefix 
    } as StringPattern)));
  }
  
  // Version patterns
  if (params.allow_version_patterns) {
    allowPatterns.push(...params.allow_version_patterns.map((version: any) => ({ 
      version: version 
    } as VersionPattern)));
  }
  if (params.ignore_version_patterns) {
    ignorePatterns.push(...params.ignore_version_patterns.map((version: any) => ({ 
      version: version 
    } as VersionPattern)));
  }
  
  // Glob patterns
  if (params.allow_glob_patterns) {
    allowPatterns.push(...params.allow_glob_patterns);
  }
  if (params.ignore_glob_patterns) {
    ignorePatterns.push(...params.ignore_glob_patterns);
  }
  
  // Regex patterns (convert to proper regex format)
  if (params.allow_regex_patterns) {
    allowPatterns.push(...params.allow_regex_patterns.map((pattern: string) => 
      pattern.startsWith('/') && pattern.endsWith('/') ? pattern : `/${pattern}/`
    ));
  }
  if (params.ignore_regex_patterns) {
    ignorePatterns.push(...params.ignore_regex_patterns.map((pattern: string) => 
      pattern.startsWith('/') && pattern.endsWith('/') ? pattern : `/${pattern}/`
    ));
  }
  
  return { allowPatterns, ignorePatterns };
}

export class WebScrapingMcpTools {
  private scrapingOptimizer: ScrapingOptimizer;
  private memoryService: MemoryService;
  
  constructor(
    private webScrapingService: WebScrapingService,
    private knowledgeGraphService: KnowledgeGraphService,
    private repositoryPath: string,
    private db: any
  ) {
    this.scrapingOptimizer = new ScrapingOptimizer(repositoryPath);
    this.memoryService = new MemoryService(db);
  }

  /**
   * Get all web scraping related MCP tools
   */
  getTools(): McpTool[] {
    return [
      {
        name: 'scrape_documentation',
        description: 'Scrape documentation from a website using intelligent sub-agents. Jobs are queued and processed automatically by the background worker. Supports plain string selectors for content extraction.',
        inputSchema: zodToJsonSchema(ScrapeDocumentationSchema),
        outputSchema: zodToJsonSchema(ScrapeDocumentationResponseSchema),
        handler: this.scrapeDocumentation.bind(this),
      },
      {
        name: 'get_scraping_status',
        description: 'Get status of active and recent scraping jobs (worker runs automatically)',
        inputSchema: zodToJsonSchema(GetScrapingStatusSchema),
        outputSchema: zodToJsonSchema(GetScrapingStatusResponseSchema),
        handler: this.getScrapingStatus.bind(this),
      },
      {
        name: 'cancel_scrape_job',
        description: 'Cancel an active or pending scraping job',
        inputSchema: zodToJsonSchema(CancelScrapeJobSchema),
        outputSchema: zodToJsonSchema(CancelScrapeJobResponseSchema),
        handler: this.cancelScrapeJob.bind(this),
      },
      {
        name: 'force_unlock_job',
        description: 'Force unlock a stuck scraping job - useful for debugging and recovery',
        inputSchema: zodToJsonSchema(ForceUnlockJobSchema),
        outputSchema: zodToJsonSchema(ForceUnlockJobResponseSchema),
        handler: this.forceUnlockJob.bind(this),
      },
      {
        name: 'force_unlock_stuck_jobs',
        description: 'Force unlock all stuck scraping jobs (jobs that haven\'t been updated recently)',
        inputSchema: zodToJsonSchema(ForceUnlockStuckJobsSchema),
        outputSchema: zodToJsonSchema(ForceUnlockStuckJobsResponseSchema),
        handler: this.forceUnlockStuckJobs.bind(this),
      },
      // Manual worker control tools removed - worker now starts/stops automatically with MCP server
      {
        name: 'list_documentation_sources',
        description: 'List all configured documentation sources',
        inputSchema: zodToJsonSchema(ListDocumentationSourcesSchema),
        outputSchema: zodToJsonSchema(ListDocumentationSourcesResponseSchema),
        handler: this.listDocumentationSources.bind(this),
      },
      {
        name: 'delete_pages_by_pattern',
        description: 'Delete website pages matching URL patterns (useful for cleaning up version URLs, static assets)',
        inputSchema: zodToJsonSchema(DeletePagesByPatternSchema),
        outputSchema: zodToJsonSchema(DeletePagesByPatternResponseSchema),
        handler: this.deletePagesByPattern.bind(this),
      },
      {
        name: 'delete_pages_by_ids',
        description: 'Delete specific pages by their IDs',
        inputSchema: zodToJsonSchema(DeletePagesByIdsSchema),
        outputSchema: zodToJsonSchema(DeletePagesByIdsResponseSchema),
        handler: this.deletePagesByIds.bind(this),
      },
      {
        name: 'delete_all_website_pages',
        description: 'Delete all pages for a website (useful for clean slate before re-scraping)',
        inputSchema: zodToJsonSchema(DeleteAllWebsitePagesSchema),
        outputSchema: zodToJsonSchema(DeleteAllWebsitePagesResponseSchema),
        handler: this.deleteAllWebsitePages.bind(this),
      }
    ];
  }


  private async scrapeDocumentation(args: any): Promise<WebScrapingResponse> {
    const startTime = Date.now();
    
    try {
      // Map snake_case parameters to camelCase
      const mappedArgs = mapSnakeCaseToCamelCase(args);
      const params = ScrapeDocumentationSchema.parse(mappedArgs);
    
    // Optimize parameters using MCP sampling if enabled
    let optimizedParams = params;
    let optimizationResult = null;
    
    if (params.enable_sampling) {
      try {
        const hasUserProvidedParams = 
          params.allow_patterns?.length > 0 ||
          params.ignore_patterns?.length > 0 ||
          params.allow_path_segments?.length > 0 ||
          params.ignore_path_segments?.length > 0 ||
          params.allow_file_extensions?.length > 0 ||
          params.ignore_file_extensions?.length > 0 ||
          params.allow_url_contains?.length > 0 ||
          params.ignore_url_contains?.length > 0 ||
          params.allow_url_starts_with?.length > 0 ||
          params.ignore_url_starts_with?.length > 0 ||
          params.allow_version_patterns?.length > 0 ||
          params.ignore_version_patterns?.length > 0 ||
          params.allow_glob_patterns?.length > 0 ||
          params.ignore_glob_patterns?.length > 0 ||
          params.allow_regex_patterns?.length > 0 ||
          params.ignore_regex_patterns?.length > 0;

        optimizationResult = await this.scrapingOptimizer.optimizeParameters(
          {
            url: params.url,
            name: params.name,
            sourceType: params.source_type,
            userProvidedParams: hasUserProvidedParams ? {
              maxPages: params.max_pages,
              selectors: params.selectors,
              includeSubdomains: params.include_subdomains
            } : undefined
          },
          params.sampling_timeout
        );

        // Merge optimized parameters with user-provided ones
        // User-provided parameters take precedence
        optimizedParams = {
          ...params,
          max_pages: hasUserProvidedParams ? params.max_pages : optimizationResult.maxPages,
          selectors: params.selectors || optimizationResult.selectors,
          include_subdomains: hasUserProvidedParams ? params.include_subdomains : optimizationResult.includeSubdomains,
          // Add optimized patterns if no user patterns provided
          ...(hasUserProvidedParams ? {} : {
            allow_patterns: optimizationResult.allowPatterns,
            ignore_patterns: optimizationResult.ignorePatterns
          })
        };

        // Log optimization results
        if (params.agent_id) {
          await this.memoryService.storeInsight(
            this.repositoryPath,
            params.agent_id,
            'Scraping parameter optimization',
            `Optimized parameters for ${params.url}:\n` +
            `- Confidence: ${optimizationResult.confidence}\n` +
            `- Reasoning: ${optimizationResult.reasoning}\n` +
            `- Max pages: ${optimizationResult.maxPages}\n` +
            `- Allow patterns: ${optimizationResult.allowPatterns.length}\n` +
            `- Ignore patterns: ${optimizationResult.ignorePatterns.length}`,
            ['scraping', 'optimization', 'parameters']
          );
        }
      } catch (error) {
        // Fall back to user parameters or defaults if optimization fails
        const fallbackResult = this.scrapingOptimizer.getFallbackParameters({
          url: params.url,
          name: params.name,
          sourceType: params.source_type
        });
        
        // Use fallback if no user parameters provided
        const hasUserProvidedParams = 
          params.allow_patterns?.length > 0 ||
          params.ignore_patterns?.length > 0;
          
        if (!hasUserProvidedParams) {
          optimizedParams = {
            ...params,
            allow_patterns: fallbackResult.allowPatterns,
            ignore_patterns: fallbackResult.ignorePatterns
          };
        }

        // Log fallback usage
        if (params.agent_id) {
          await this.memoryService.storeError(
            this.repositoryPath,
            params.agent_id,
            `Failed to optimize parameters for ${params.url}: ${error instanceof Error ? error.message : 'Unknown error'}. Using fallback parameters.`,
            { url: params.url, error: error instanceof Error ? error.message : 'Unknown error' },
            ['scraping', 'optimization', 'error', 'fallback']
          );
        }
      }
    }
    
    // Convert typed parameters to internal pattern format
    const { allowPatterns, ignorePatterns } = convertTypedParametersToPatterns(optimizedParams);
    
    // Validate patterns and provide helpful error messages
    if (allowPatterns.length > 0) {
      const invalidPatterns = allowPatterns.filter(pattern => {
        if (typeof pattern === 'string') {
          return !PatternMatcher.validatePattern(pattern).valid;
        }
        // For JSON patterns, basic validation - they'll be validated during matching
        return typeof pattern !== 'object' || pattern === null;
      });
      if (invalidPatterns.length > 0) {
        return createErrorResponse(
          'Invalid pattern configuration',
          `Invalid allow patterns: ${invalidPatterns.map(p => typeof p === 'string' ? p : JSON.stringify(p)).join(', ')}. ${PatternMatcher.getPatternDocumentation()}`,
          'INVALID_PATTERNS'
        );
      }
    }
    
    if (ignorePatterns.length > 0) {
      const invalidPatterns = ignorePatterns.filter(pattern => {
        if (typeof pattern === 'string') {
          return !PatternMatcher.validatePattern(pattern).valid;
        }
        // For JSON patterns, basic validation - they'll be validated during matching
        return typeof pattern !== 'object' || pattern === null;
      });
      if (invalidPatterns.length > 0) {
        return createErrorResponse(
          'Invalid pattern configuration',
          `Invalid ignore patterns: ${invalidPatterns.map(p => typeof p === 'string' ? p : JSON.stringify(p)).join(', ')}. ${PatternMatcher.getPatternDocumentation()}`,
          'INVALID_PATTERNS'
        );
      }
    }
    
    // Create documentation source if it doesn't exist
    const sourceId = await this.getOrCreateDocumentationSource(optimizedParams);
    
    // Queue the scraping job
    const result = await this.webScrapingService.queueScrapeJob(
      sourceId,
      {
        sourceUrl: optimizedParams.url,
        sourceName: optimizedParams.name || new URL(optimizedParams.url).hostname,
        maxPages: optimizedParams.max_pages,
        selectors: optimizedParams.selectors,
        allowPatterns: allowPatterns.length > 0 ? allowPatterns : undefined,
        ignorePatterns: ignorePatterns.length > 0 ? ignorePatterns : undefined,
        includeSubdomains: optimizedParams.include_subdomains,
        forceRefresh: optimizedParams.force_refresh,
        agentId: optimizedParams.agent_id
      },
      5 // Default priority
    );

    if (result.success && params.agent_id) {
      await this.memoryService.storeInsight(
        this.repositoryPath,
        params.agent_id,
        'Documentation scraping queued',
        `Queued scraping for ${params.name || params.url} - Job ID: ${result.jobId}`,
        ['scraping', 'documentation', 'queued', 'job']
      );
    }

      const executionTime = Date.now() - startTime;
      
      if (!result.success) {
        return createErrorResponse(
          'Failed to queue scraping job',
          result.error || 'Unknown error occurred during job queueing',
          'QUEUE_ERROR'
        );
      }
      
      return createSuccessResponse(
        result.skipped 
          ? `Scraping job already exists for ${optimizedParams.name || optimizedParams.url}${optimizationResult ? ` (optimized with ${Math.round(optimizationResult.confidence * 100)}% confidence)` : ''}`
          : `Scraping job queued for ${optimizedParams.name || optimizedParams.url}${optimizationResult ? ` (optimized with ${Math.round(optimizationResult.confidence * 100)}% confidence)` : ''}`,
        {
          job_id: result.jobId,
          source_id: sourceId,
          pages_scraped: 0,
          pages_total: optimizedParams.max_pages,
          status: result.skipped ? 'skipped' : 'queued',
          websites: [{
            id: sourceId,
            name: optimizedParams.name || new URL(optimizedParams.url).hostname,
            url: optimizedParams.url,
            max_pages: optimizedParams.max_pages,
            optimization: optimizationResult ? {
              enabled: params.enable_sampling,
              confidence: optimizationResult.confidence,
              reasoning: optimizationResult.reasoning,
              optimized_parameters: {
                max_pages: optimizationResult.maxPages,
                selectors: optimizationResult.selectors,
                allow_patterns_count: optimizationResult.allowPatterns.length,
                ignore_patterns_count: optimizationResult.ignorePatterns.length,
                include_subdomains: optimizationResult.includeSubdomains
              }
            } : {
              enabled: params.enable_sampling,
              status: params.enable_sampling ? 'fallback_used' : 'disabled'
            }
          }]
        },
        executionTime
      );
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      return createErrorResponse(
        'Failed to scrape documentation',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'SCRAPING_ERROR'
      );
    }
  }

  private async getScrapingStatus(args: any): Promise<WebScrapingResponse> {
    const startTime = Date.now();
    
    try {
      // Map snake_case parameters to camelCase
      const mappedArgs = mapSnakeCaseToCamelCase(args);
      const params = GetScrapingStatusSchema.parse(mappedArgs);
      
      const status = await this.webScrapingService.getScrapingStatus(params.source_id);
      const executionTime = Date.now() - startTime;
      
      if (!params.include_job_details) {
        return createSuccessResponse(
          `Retrieved scraping status summary${params.source_id ? ` for source ${params.source_id}` : ''}`,
          {
            source_id: params.source_id,
            status: 'summary',
            jobs: [{
              activeJobs: status.activeJobs.length,
              pendingJobs: status.pendingJobs.length,
              completedJobs: status.completedJobs.length,
              failedJobs: status.failedJobs.length,
              workerStatus: status.workerStatus
            }]
          },
          executionTime
        );
      }

      return createSuccessResponse(
        `Retrieved detailed scraping status${params.source_id ? ` for source ${params.source_id}` : ''}`,
        {
          source_id: params.source_id,
          status: 'detailed',
          jobs: [...status.activeJobs, ...status.pendingJobs, ...status.completedJobs, ...status.failedJobs],
          pages_scraped: status.activeJobs.reduce((sum: number, job: any) => sum + (job.progress?.pagesCrawled || 0), 0),
          pages_total: status.activeJobs.reduce((sum: number, job: any) => sum + (job.maxPages || 0), 0)
        },
        executionTime
      );
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      return createErrorResponse(
        'Failed to get scraping status',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'STATUS_ERROR'
      );
    }
  }

  private async cancelScrapeJob(args: any): Promise<WebScrapingResponse> {
    const startTime = Date.now();
    
    try {
      // Map snake_case parameters to camelCase
      const mappedArgs = mapSnakeCaseToCamelCase(args);
      const params = CancelScrapeJobSchema.parse(mappedArgs);
      
      const result = await this.webScrapingService.cancelScrapeJob(params.job_id);
      const executionTime = Date.now() - startTime;
      
      if (!result.success) {
        return createErrorResponse(
          `Failed to cancel scraping job ${params.job_id}`,
          result.error || 'Unknown error occurred during job cancellation',
          'CANCEL_ERROR'
        );
      }
      
      return createSuccessResponse(
        `Scraping job ${params.job_id} cancelled successfully`,
        {
          job_id: params.job_id,
          status: 'cancelled'
        },
        executionTime
      );
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      return createErrorResponse(
        'Failed to cancel scraping job',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'CANCEL_ERROR'
      );
    }
  }

  private async forceUnlockJob(args: any): Promise<WebScrapingResponse> {
    const startTime = Date.now();
    
    try {
      // Map snake_case parameters to camelCase
      const mappedArgs = mapSnakeCaseToCamelCase(args);
      const params = ForceUnlockJobSchema.parse(mappedArgs);
      
      const result = await this.webScrapingService.forceUnlockJob(params.job_id, params.reason);
      const executionTime = Date.now() - startTime;
      
      if (!result.success) {
        return createErrorResponse(
          `Failed to force unlock scraping job ${params.job_id}`,
          result.error || 'Unknown error occurred during force unlock',
          'UNLOCK_ERROR'
        );
      }
      
      return createSuccessResponse(
        `Scraping job ${params.job_id} force unlocked successfully`,
        {
          job_id: params.job_id,
          status: 'unlocked',
          ...(params.reason && { reason: params.reason })
        },
        executionTime
      );
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      return createErrorResponse(
        'Failed to force unlock job',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'UNLOCK_ERROR'
      );
    }
  }

  private async forceUnlockStuckJobs(args: any): Promise<WebScrapingResponse> {
    const startTime = Date.now();
    
    try {
      // Map snake_case parameters to camelCase
      const mappedArgs = mapSnakeCaseToCamelCase(args);
      const params = ForceUnlockStuckJobsSchema.parse(mappedArgs);
      
      const result = await this.webScrapingService.forceUnlockStuckJobs(params.stuck_threshold_minutes);
      const executionTime = Date.now() - startTime;
      
      if (!result.success) {
        return createErrorResponse(
          'Failed to force unlock stuck jobs',
          result.error || 'Unknown error occurred during batch unlock',
          'BATCH_UNLOCK_ERROR'
        );
      }
      
      return createSuccessResponse(
        `Force unlocked ${result.unlockedCount} stuck jobs (stuck for more than ${params.stuck_threshold_minutes} minutes)`,
        {
          job_id: 'batch_unlock',
          status: 'batch_unlocked',
          jobs: result.unlockedCount || [],
          deleted_count: result.unlockedCount
        },
        executionTime
      );
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      return createErrorResponse(
        'Failed to force unlock stuck jobs',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'BATCH_UNLOCK_ERROR'
      );
    }
  }

  // Manual worker control methods removed - worker now starts/stops automatically with MCP server

  private async listDocumentationSources(args: any): Promise<WebScrapingResponse> {
    const startTime = Date.now();
    
    try {
      // Map snake_case parameters to camelCase
      const mappedArgs = mapSnakeCaseToCamelCase(args);
      const params = ListDocumentationSourcesSchema.parse(mappedArgs);
      
      // List all websites and their page counts if stats are requested
      const websites = await this.webScrapingService['websiteRepository'].listWebsites({ limit: 100 });
      
      const sources = await Promise.all(websites.map(async (website) => {
        let pageCount = 0;
        if (params.include_stats) {
          pageCount = await this.webScrapingService['websitePagesRepository'].countByWebsiteId(website.id);
        }
        
        return {
          id: website.id,
          name: website.name,
          domain: website.domain,
          metaDescription: website.metaDescription,
          createdAt: website.createdAt,
          updatedAt: website.updatedAt,
          ...(params.include_stats && { pageCount })
        };
      }));
      
      const executionTime = Date.now() - startTime;
      
      return createSuccessResponse(
        `Found ${websites.length} documentation websites`,
        {
          sources,
          total_sources: websites.length
        },
        executionTime
      );
    } catch (error) {
      const executionTime = Date.now() - startTime;
      return createErrorResponse(
        'Failed to list documentation sources',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'LIST_SOURCES_ERROR'
      );
    }
  }

  /**
   * Get or create a documentation source for the given parameters
   */
  private async getOrCreateDocumentationSource(params: any): Promise<string> {
    const { allowPatterns, ignorePatterns } = convertTypedParametersToPatterns(params);
    
    return this.webScrapingService.getOrCreateDocumentationSource({
      url: params.url,
      name: params.name,
      sourceType: params.source_type,
      maxPages: params.max_pages,
      selectors: params.selectors,
      allowPatterns: allowPatterns.length > 0 ? allowPatterns : undefined,
      ignorePatterns: ignorePatterns.length > 0 ? ignorePatterns : undefined,
      includeSubdomains: params.include_subdomains
    });
  }

  private async deletePagesByPattern(args: any): Promise<WebScrapingResponse> {
    const startTime = Date.now();
    
    try {
      // Map snake_case parameters to camelCase
      const mappedArgs = mapSnakeCaseToCamelCase(args);
      const params = DeletePagesByPatternSchema.parse(mappedArgs);
      
      // Get all pages for this website
      const pages = await this.webScrapingService['websitePagesRepository'].listByWebsiteId(params.website_id, { limit: 10000 });
      
      if (pages.length === 0) {
        const executionTime = Date.now() - startTime;
        return createSuccessResponse(
          `No pages found for website ${params.website_id}`,
          {
            pages_matched: 0,
            pages_deleted: 0,
            dry_run: params.dry_run,
            patterns_used: params.url_patterns,
            total_pages_scanned: 0
          },
          executionTime
        );
      }

      // Find pages that match the deletion patterns
      const matchedPages = pages.filter(page => {
        // Use PatternMatcher to check if any pattern matches this URL
        // Since we want to DELETE matches, we invert the shouldAllowUrl logic
        const result = PatternMatcher.shouldAllowUrl(page.url, params.url_patterns, []);
        return result.allowed; // If pattern matches (allowed), it should be deleted
      });

      const matchedUrls = matchedPages.map(page => ({ id: page.id, url: page.url }));

      if (params.dry_run) {
        const executionTime = Date.now() - startTime;
        return createSuccessResponse(
          `DRY RUN: Would delete ${matchedPages.length} pages matching patterns`,
          {
            pages_matched: matchedPages.length,
            pages_deleted: 0,
            dry_run: true,
            matched_urls: matchedUrls.slice(0, 20), // Show first 20 for preview
            patterns_used: params.url_patterns,
            total_pages_scanned: pages.length
          },
          executionTime
        );
      }

      // Actually delete the pages
      let deletedCount = 0;
      for (const page of matchedPages) {
        const deleted = await this.webScrapingService['websitePagesRepository'].delete(page.id);
        if (deleted) {
          deletedCount++;
        }
      }

      const executionTime = Date.now() - startTime;
      
      return createSuccessResponse(
        `Successfully deleted ${deletedCount} pages matching patterns`,
        {
          pages_matched: matchedPages.length,
          pages_deleted: deletedCount,
          dry_run: false,
          patterns_used: params.url_patterns,
          total_pages_scanned: pages.length
        },
        executionTime
      );
    } catch (error) {
      const executionTime = Date.now() - startTime;
      return createErrorResponse(
        'Failed to delete pages by pattern',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'DELETE_PATTERN_ERROR'
      );
    }
  }

  private async deletePagesByIds(args: any): Promise<WebScrapingResponse> {
    const startTime = Date.now();
    
    try {
      // Map snake_case parameters to camelCase
      const mappedArgs = mapSnakeCaseToCamelCase(args);
      const params = DeletePagesByIdsSchema.parse(mappedArgs);
      
      let deletedCount = 0;
      const results = [];

      for (const pageId of params.page_ids) {
        try {
          const deleted = await this.webScrapingService['websitePagesRepository'].delete(pageId);
          results.push({
            page_id: pageId,
            deleted: deleted,
            error: deleted ? null : 'Page not found or already deleted'
          });
          if (deleted) {
            deletedCount++;
          }
        } catch (error) {
          results.push({
            page_id: pageId,
            deleted: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      const executionTime = Date.now() - startTime;
      
      return createSuccessResponse(
        `Successfully deleted ${deletedCount} of ${params.page_ids.length} pages`,
        {
          pages_deleted: deletedCount,
          total_requested: params.page_ids.length,
          results
        },
        executionTime
      );
    } catch (error) {
      const executionTime = Date.now() - startTime;
      return createErrorResponse(
        'Failed to delete pages by IDs',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'DELETE_BY_IDS_ERROR'
      );
    }
  }

  private async deleteAllWebsitePages(args: any): Promise<WebScrapingResponse> {
    const startTime = Date.now();
    
    try {
      // Map snake_case parameters to camelCase
      const mappedArgs = mapSnakeCaseToCamelCase(args);
      const params = DeleteAllWebsitePagesSchema.parse(mappedArgs);
      
      if (!params.confirm) {
        const executionTime = Date.now() - startTime;
        return createErrorResponse(
          'Safety check failed',
          'confirm parameter must be true to delete all pages for a website',
          'CONFIRMATION_REQUIRED'
        );
      }

      // Get current page count for reporting
      const pageCount = await this.webScrapingService['websitePagesRepository'].countByWebsiteId(params.website_id);
      
      if (pageCount === 0) {
        const executionTime = Date.now() - startTime;
        return createSuccessResponse(
          `No pages found for website ${params.website_id}`,
          {
            pages_deleted: 0,
            website_id: params.website_id
          },
          executionTime
        );
      }

      // Delete all pages for this website
      const deletedCount = await this.webScrapingService['websitePagesRepository'].deleteByWebsiteId(params.website_id);

      const executionTime = Date.now() - startTime;
      
      return createSuccessResponse(
        `Successfully deleted all ${deletedCount} pages for website ${params.website_id}`,
        {
          pages_deleted: deletedCount,
          website_id: params.website_id
        },
        executionTime
      );
    } catch (error) {
      const executionTime = Date.now() - startTime;
      return createErrorResponse(
        'Failed to delete all website pages',
        error instanceof Error ? error.message : 'Unknown error occurred',
        'DELETE_ALL_PAGES_ERROR'
      );
    }
  }
}