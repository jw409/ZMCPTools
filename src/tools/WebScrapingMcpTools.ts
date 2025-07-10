/**
 * MCP Tools for web scraping and documentation intelligence
 * Exposes sub-agent based scraping functionality through MCP protocol
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createHash } from 'crypto';
import type { WebScrapingService } from '../services/WebScrapingService.js';
import type { KnowledgeGraphService } from '../services/KnowledgeGraphService.js';
import { MemoryService } from '../services/MemoryService.js';
import { PatternMatcher, type ScrapingPattern, type StringPattern, type PathPattern, type VersionPattern } from '../utils/patternMatcher.js';
import { ScrapingOptimizer } from '../utils/scrapingOptimizer.js';
import { WebScrapingResponseSchema, createSuccessResponse, createErrorResponse, type WebScrapingResponse } from '../schemas/toolResponses.js';

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

// Validation schemas
const ScrapeDocumentationSchema = z.object({
  url: z.string().url(),
  name: z.string().optional(),
  source_type: z.enum(['api', 'guide', 'reference', 'tutorial']).default('guide'),
  max_pages: z.number().int().min(1).max(1000).default(200),
  selectors: z.string().optional(),
  
  // Legacy pattern support
  allow_patterns: z.array(z.union([z.string(), z.record(z.any())])).optional().refine(
    (patterns) => !patterns || validatePatternArray(patterns),
    { message: "Invalid pattern format. Use string patterns (*/docs/*), regex patterns (/api\\/v[0-9]+\\/.*/) or JSON patterns ({\"path_segment\": \"docs\"})." }
  ),
  ignore_patterns: z.array(z.union([z.string(), z.record(z.any())])).optional().refine(
    (patterns) => !patterns || validatePatternArray(patterns),
    { message: "Invalid pattern format. Use string patterns (*/private/*), regex patterns (/login|admin/) or JSON patterns ({\"extension\": [\"js\", \"css\"]})." }
  ),
  
  // Typed pattern parameters
  allow_path_segments: z.array(z.string()).optional(),
  ignore_path_segments: z.array(z.string()).optional(),
  allow_file_extensions: z.array(z.string()).optional(),
  ignore_file_extensions: z.array(z.string()).optional(),
  allow_url_contains: z.array(z.string()).optional(),
  ignore_url_contains: z.array(z.string()).optional(),
  allow_url_starts_with: z.array(z.string()).optional(),
  ignore_url_starts_with: z.array(z.string()).optional(),
  allow_version_patterns: z.array(z.object({
    prefix: z.string(),
    major: z.number().optional(),
    minor: z.number().optional(),
    patch: z.number().optional()
  })).optional(),
  ignore_version_patterns: z.array(z.object({
    prefix: z.string(),
    major: z.number().optional(),
    minor: z.number().optional(),
    patch: z.number().optional()
  })).optional(),
  allow_glob_patterns: z.array(z.string()).optional(),
  ignore_glob_patterns: z.array(z.string()).optional(),
  allow_regex_patterns: z.array(z.string()).optional(),
  ignore_regex_patterns: z.array(z.string()).optional(),
  
  include_subdomains: z.boolean().default(false),
  force_refresh: z.boolean().default(false),
  agent_id: z.string().optional(),
  enable_sampling: z.boolean().default(true),
  sampling_timeout: z.number().optional().default(30000)
});

const GetScrapingStatusSchema = z.object({
  source_id: z.string().optional(),
  include_job_details: z.boolean().default(true)
});

const CancelScrapeJobSchema = z.object({
  job_id: z.string()
});

const ForceUnlockJobSchema = z.object({
  job_id: z.string(),
  reason: z.string().optional()
});

const ForceUnlockStuckJobsSchema = z.object({
  stuck_threshold_minutes: z.number().min(1).max(1440).default(30),
});

// StartScrapingWorkerSchema removed - worker now starts automatically with MCP server

const DeletePagesByPatternSchema = z.object({
  website_id: z.string(),
  url_patterns: z.array(z.string()),
  dry_run: z.boolean().default(true)
});

const DeletePagesByIdsSchema = z.object({
  page_ids: z.array(z.string()).min(1)
});

const DeleteAllWebsitePagesSchema = z.object({
  website_id: z.string(),
  confirm: z.boolean().default(false)
});

// Export schemas for MCP server registration
export { 
  ScrapeDocumentationSchema,
  GetScrapingStatusSchema,
  CancelScrapeJobSchema,
  ForceUnlockJobSchema,
  ForceUnlockStuckJobsSchema,
  DeletePagesByPatternSchema,
  DeletePagesByIdsSchema,
  DeleteAllWebsitePagesSchema
};

// Export inferred types
export type ScrapeDocumentationInput = z.infer<typeof ScrapeDocumentationSchema>;
export type GetScrapingStatusInput = z.infer<typeof GetScrapingStatusSchema>;
export type CancelScrapeJobInput = z.infer<typeof CancelScrapeJobSchema>;
export type ForceUnlockJobInput = z.infer<typeof ForceUnlockJobSchema>;
export type ForceUnlockStuckJobsInput = z.infer<typeof ForceUnlockStuckJobsSchema>;
export type DeletePagesByPatternInput = z.infer<typeof DeletePagesByPatternSchema>;
export type DeletePagesByIdsInput = z.infer<typeof DeletePagesByIdsSchema>;
export type DeleteAllWebsitePagesInput = z.infer<typeof DeleteAllWebsitePagesSchema>;

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
  getTools(): Tool[] {
    return [
      {
        name: 'scrape_documentation',
        description: 'Scrape documentation from a website using intelligent sub-agents. Jobs are queued and processed automatically by the background worker. Supports plain string selectors for content extraction.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              format: 'uri',
              description: 'Base URL of the documentation site to scrape'
            },
            name: {
              type: 'string',
              description: 'Human-readable name for this documentation source'
            },
            source_type: {
              type: 'string',
              enum: ['api', 'guide', 'reference', 'tutorial'],
              default: 'guide',
              description: 'Type of documentation being scraped'
            },
            max_pages: {
              type: 'number',
              minimum: 1,
              maximum: 1000,
              default: 200,
              description: 'Maximum number of pages to scrape (default: 200 for comprehensive documentation coverage)'
            },
            selectors: {
              type: 'string',
              description: 'CSS selector or JavaScript code for extracting specific content (e.g., "article", "main .content", or "document.querySelector(\'.content\')")'
            },
            // String and JSON pattern arrays (legacy support)
            allow_patterns: {
              type: 'array',
              items: { 
                oneOf: [
                  { type: 'string' },
                  { type: 'object' }
                ]
              },
              description: 'URL patterns to include during crawling (allowlist). Supports: 1) String patterns: glob patterns (**/docs/**), regex patterns (/api\\/v[0-9]+\\/.*/) or plain strings. 2) JSON patterns (recommended for AI): {"path_segment": "docs"}, {"extension": ["html", "htm"]}, {"version": {"prefix": "v", "major": 1}}, {"and": [{"contains": "/docs/"}, {"not": {"extension": "pdf"}}]}. JSON patterns are more readable and powerful for complex logic.'
            },
            ignore_patterns: {
              type: 'array',
              items: { 
                oneOf: [
                  { type: 'string' },
                  { type: 'object' }
                ]
              },
              description: 'URL patterns to ignore during crawling (blocklist). Supports: 1) String patterns: glob patterns (**/private/**), regex patterns (/login|admin/) or plain strings. 2) JSON patterns (recommended for AI): {"extension": ["js", "css", "png"]}, {"version": {"prefix": "v"}}, {"or": [{"contains": "/private/"}, {"path_segment": "admin"}]}. JSON patterns provide better readability and logical operations.'
            },
            
            // Typed pattern parameters (recommended for AI)
            allow_path_segments: {
              type: 'array',
              items: { type: 'string' },
              description: 'Path segments to allow (e.g., ["docs", "api", "guides"])'
            },
            ignore_path_segments: {
              type: 'array',
              items: { type: 'string' },
              description: 'Path segments to ignore (e.g., ["private", "admin", "internal"])'
            },
            allow_file_extensions: {
              type: 'array',
              items: { type: 'string' },
              description: 'File extensions to allow (e.g., ["html", "htm", "md"])'
            },
            ignore_file_extensions: {
              type: 'array',
              items: { type: 'string' },
              description: 'File extensions to ignore (e.g., ["js", "css", "png", "jpg", "pdf"])'
            },
            allow_url_contains: {
              type: 'array',
              items: { type: 'string' },
              description: 'URL substrings that must be present (e.g., ["/docs/", "/api/"])'
            },
            ignore_url_contains: {
              type: 'array',
              items: { type: 'string' },
              description: 'URL substrings to ignore (e.g., ["/private/", "/admin/"])'
            },
            allow_url_starts_with: {
              type: 'array',
              items: { type: 'string' },
              description: 'URL prefixes to allow (e.g., ["https://docs.example.com", "https://api.example.com"])'
            },
            ignore_url_starts_with: {
              type: 'array',
              items: { type: 'string' },
              description: 'URL prefixes to ignore (e.g., ["https://private.example.com", "https://admin.example.com"])'
            },
            allow_version_patterns: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  prefix: { type: 'string', description: 'Version prefix (e.g., "v", "api/v")' },
                  major: { type: 'number', description: 'Major version number' },
                  minor: { type: 'number', description: 'Minor version number' },
                  patch: { type: 'number', description: 'Patch version number' }
                },
                required: ['prefix']
              },
              description: 'Version patterns to allow (e.g., [{"prefix": "v", "major": 1}, {"prefix": "api/v", "major": 2}])'
            },
            ignore_version_patterns: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  prefix: { type: 'string', description: 'Version prefix (e.g., "v", "api/v")' },
                  major: { type: 'number', description: 'Major version number' },
                  minor: { type: 'number', description: 'Minor version number' },
                  patch: { type: 'number', description: 'Patch version number' }
                },
                required: ['prefix']
              },
              description: 'Version patterns to ignore (e.g., [{"prefix": "v", "major": 0}, {"prefix": "api/v", "major": 1}])'
            },
            allow_glob_patterns: {
              type: 'array',
              items: { type: 'string' },
              description: 'Glob patterns to allow (e.g., ["**/docs/**", "**/api/**"])'
            },
            ignore_glob_patterns: {
              type: 'array',
              items: { type: 'string' },
              description: 'Glob patterns to ignore (e.g., ["**/private/**", "**/admin/**"])'
            },
            allow_regex_patterns: {
              type: 'array',
              items: { type: 'string' },
              description: 'Regex patterns to allow (e.g., ["/api/v[0-9]+/.*", "/docs/[a-z]+/.*"])'
            },
            ignore_regex_patterns: {
              type: 'array',
              items: { type: 'string' },
              description: 'Regex patterns to ignore (e.g., ["/login", "/admin", "/private"])'
            },
            include_subdomains: {
              type: 'boolean',
              default: false,
              description: 'Whether to include subdomains when crawling'
            },
            force_refresh: {
              type: 'boolean',
              default: false,
              description: 'Force refresh even if recently scraped'
            },
            agent_id: {
              type: 'string',
              description: 'ID of the agent requesting this scraping'
            },
            enable_sampling: {
              type: 'boolean',
              default: true,
              description: 'Enable intelligent parameter optimization using MCP sampling'
            },
            sampling_timeout: {
              type: 'number',
              default: 30000,
              description: 'Timeout for sampling optimization in milliseconds'
            }
          },
          required: ['url']
        },
        outputSchema: WebScrapingResponseSchema
      },
      {
        name: 'get_scraping_status',
        description: 'Get status of active and recent scraping jobs (worker runs automatically)',
        inputSchema: {
          type: 'object',
          properties: {
            source_id: {
              type: 'string',
              description: 'Optional source ID to filter results'
            },
            include_job_details: {
              type: 'boolean',
              default: true,
              description: 'Include detailed job information in response'
            }
          },
          required: []
        },
        outputSchema: WebScrapingResponseSchema
      },
      {
        name: 'cancel_scrape_job',
        description: 'Cancel an active or pending scraping job',
        inputSchema: {
          type: 'object',
          properties: {
            job_id: {
              type: 'string',
              description: 'ID of the scraping job to cancel'
            }
          },
          required: ['job_id']
        },
        outputSchema: WebScrapingResponseSchema
      },
      {
        name: 'force_unlock_job',
        description: 'Force unlock a stuck scraping job - useful for debugging and recovery',
        inputSchema: {
          type: 'object',
          properties: {
            job_id: {
              type: 'string',
              description: 'ID of the scraping job to force unlock'
            },
            reason: {
              type: 'string',
              description: 'Optional reason for force unlocking the job'
            }
          },
          required: ['job_id']
        },
        outputSchema: WebScrapingResponseSchema
      },
      {
        name: 'force_unlock_stuck_jobs',
        description: 'Force unlock all stuck scraping jobs (jobs that haven\'t been updated recently)',
        inputSchema: {
          type: 'object',
          properties: {
            stuck_threshold_minutes: {
              type: 'number',
              minimum: 1,
              maximum: 1440,
              default: 30,
              description: 'Consider jobs stuck if they haven\'t been updated for this many minutes'
            }
          },
          required: []
        },
        outputSchema: WebScrapingResponseSchema
      },
      // Manual worker control tools removed - worker now starts/stops automatically with MCP server
      {
        name: 'list_documentation_sources',
        description: 'List all configured documentation sources',
        inputSchema: {
          type: 'object',
          properties: {
            include_stats: {
              type: 'boolean',
              default: true,
              description: 'Include entry counts and last scraped info'
            }
          },
          required: []
        },
        outputSchema: WebScrapingResponseSchema
      },
      {
        name: 'delete_pages_by_pattern',
        description: 'Delete website pages matching URL patterns (useful for cleaning up version URLs, static assets)',
        inputSchema: {
          type: 'object',
          properties: {
            website_id: {
              type: 'string',
              description: 'Website ID to delete pages from'
            },
            url_patterns: {
              type: 'array',
              items: { type: 'string' },
              description: 'URL patterns to match (glob, regex, or plain strings). Examples: ["/v[0-9]+/", "**/*.js", "**/*.css"]'
            },
            dry_run: {
              type: 'boolean',
              default: true,
              description: 'Show what would be deleted without actually deleting'
            }
          },
          required: ['website_id', 'url_patterns']
        },
        outputSchema: WebScrapingResponseSchema
      },
      {
        name: 'delete_pages_by_ids',
        description: 'Delete specific pages by their IDs',
        inputSchema: {
          type: 'object',
          properties: {
            page_ids: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              description: 'Array of page IDs to delete'
            }
          },
          required: ['page_ids']
        },
        outputSchema: WebScrapingResponseSchema
      },
      {
        name: 'delete_all_website_pages',
        description: 'Delete all pages for a website (useful for clean slate before re-scraping)',
        inputSchema: {
          type: 'object',
          properties: {
            website_id: {
              type: 'string',
              description: 'Website ID to delete all pages from'
            },
            confirm: {
              type: 'boolean',
              default: false,
              description: 'Safety check - must be true to actually delete all pages'
            }
          },
          required: ['website_id', 'confirm']
        },
        outputSchema: WebScrapingResponseSchema
      }
    ];
  }

  /**
   * Handle MCP tool calls for web scraping functionality
   */
  async handleToolCall(name: string, arguments_: any): Promise<WebScrapingResponse> {
    const startTime = Date.now();
    
    try {
      let result: WebScrapingResponse;
      
      switch (name) {
        case 'scrape_documentation':
          result = await this.scrapeDocumentation(arguments_);
          break;
        
        case 'get_scraping_status':
          result = await this.getScrapingStatus(arguments_);
          break;
        
        case 'cancel_scrape_job':
          result = await this.cancelScrapeJob(arguments_);
          break;
        
        case 'force_unlock_job':
          result = await this.forceUnlockJob(arguments_);
          break;
        
        case 'force_unlock_stuck_jobs':
          result = await this.forceUnlockStuckJobs(arguments_);
          break;
        
        // Manual worker control cases removed - worker now starts/stops automatically
        
        case 'list_documentation_sources':
          result = await this.listDocumentationSources(arguments_);
          break;
        
        case 'delete_pages_by_pattern':
          result = await this.deletePagesByPattern(arguments_);
          break;
        
        case 'delete_pages_by_ids':
          result = await this.deletePagesByIds(arguments_);
          break;
        
        case 'delete_all_website_pages':
          result = await this.deleteAllWebsitePages(arguments_);
          break;
        
        default:
          return createErrorResponse(
            `Unknown web scraping tool: ${name}`,
            `Tool '${name}' is not implemented in WebScrapingMcpTools`,
            'UNKNOWN_TOOL'
          );
      }
      
      // Ensure execution time is set
      if (!result.execution_time_ms) {
        result.execution_time_ms = Date.now() - startTime;
      }
      
      return result;
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      return createErrorResponse(
        `Web scraping tool '${name}' failed`,
        error instanceof Error ? error.message : 'Unknown error occurred',
        'EXECUTION_ERROR'
      );
    }
  }

  private async scrapeDocumentation(args: any): Promise<WebScrapingResponse> {
    const startTime = Date.now();
    
    try {
      const params = ScrapeDocumentationSchema.parse(args);
    
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
      const params = GetScrapingStatusSchema.parse(args);
      
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
      const params = CancelScrapeJobSchema.parse(args);
      
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
      const params = ForceUnlockJobSchema.parse(args);
      
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
      const params = ForceUnlockStuckJobsSchema.parse(args);
      
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
          jobs: result.unlockedJobs || [],
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

  private async listDocumentationSources(args: any) {
    const { include_stats = true } = args;
    
    try {
      // List all websites and their page counts if stats are requested
      const websites = await this.webScrapingService['websiteRepository'].listWebsites({ limit: 100 });
      
      const sources = await Promise.all(websites.map(async (website) => {
        let pageCount = 0;
        if (include_stats) {
          pageCount = await this.webScrapingService['websitePagesRepository'].countByWebsiteId(website.id);
        }
        
        return {
          id: website.id,
          name: website.name,
          domain: website.domain,
          metaDescription: website.metaDescription,
          createdAt: website.createdAt,
          updatedAt: website.updatedAt,
          ...(include_stats && { pageCount })
        };
      }));
      
      return {
        success: true,
        sources,
        total_sources: websites.length,
        message: `Found ${websites.length} documentation websites`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list documentation sources'
      };
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

  private async deletePagesByPattern(args: any) {
    const params = DeletePagesByPatternSchema.parse(args);
    
    try {
      // Get all pages for this website
      const pages = await this.webScrapingService['websitePagesRepository'].listByWebsiteId(params.website_id, { limit: 10000 });
      
      if (pages.length === 0) {
        return {
          success: true,
          message: `No pages found for website ${params.website_id}`,
          pages_matched: 0,
          pages_deleted: 0,
          dry_run: params.dry_run
        };
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
        return {
          success: true,
          message: `DRY RUN: Would delete ${matchedPages.length} pages matching patterns`,
          pages_matched: matchedPages.length,
          pages_deleted: 0,
          dry_run: true,
          matched_urls: matchedUrls.slice(0, 20), // Show first 20 for preview
          patterns_used: params.url_patterns,
          total_pages_scanned: pages.length
        };
      }

      // Actually delete the pages
      let deletedCount = 0;
      for (const page of matchedPages) {
        const deleted = await this.webScrapingService['websitePagesRepository'].delete(page.id);
        if (deleted) {
          deletedCount++;
        }
      }

      return {
        success: true,
        message: `Successfully deleted ${deletedCount} pages matching patterns`,
        pages_matched: matchedPages.length,
        pages_deleted: deletedCount,
        dry_run: false,
        patterns_used: params.url_patterns,
        total_pages_scanned: pages.length
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete pages by pattern'
      };
    }
  }

  private async deletePagesByIds(args: any) {
    const params = DeletePagesByIdsSchema.parse(args);
    
    try {
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

      return {
        success: true,
        message: `Successfully deleted ${deletedCount} of ${params.page_ids.length} pages`,
        pages_deleted: deletedCount,
        total_requested: params.page_ids.length,
        results
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete pages by IDs'
      };
    }
  }

  private async deleteAllWebsitePages(args: any) {
    const params = DeleteAllWebsitePagesSchema.parse(args);
    
    if (!params.confirm) {
      return {
        success: false,
        error: 'Safety check failed: confirm parameter must be true to delete all pages for a website'
      };
    }

    try {
      // Get current page count for reporting
      const pageCount = await this.webScrapingService['websitePagesRepository'].countByWebsiteId(params.website_id);
      
      if (pageCount === 0) {
        return {
          success: true,
          message: `No pages found for website ${params.website_id}`,
          pages_deleted: 0
        };
      }

      // Delete all pages for this website
      const deletedCount = await this.webScrapingService['websitePagesRepository'].deleteByWebsiteId(params.website_id);

      return {
        success: true,
        message: `Successfully deleted all ${deletedCount} pages for website ${params.website_id}`,
        pages_deleted: deletedCount,
        website_id: params.website_id
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete all website pages'
      };
    }
  }
}