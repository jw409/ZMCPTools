/**
 * MCP Tools for web scraping and documentation intelligence
 * Exposes sub-agent based scraping functionality through MCP protocol
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createHash } from 'crypto';
import type { WebScrapingService } from '../services/WebScrapingService.js';
import type { MemoryService } from '../services/MemoryService.js';
import { PatternMatcher } from '../utils/patternMatcher.js';

// Validation schemas
const ScrapeDocumentationSchema = z.object({
  url: z.string().url(),
  name: z.string().optional(),
  source_type: z.enum(['api', 'guide', 'reference', 'tutorial']).default('guide'),
  crawl_depth: z.number().int().min(1).max(10).default(3),
  selectors: z.record(z.string()).optional(),
  allow_patterns: z.array(z.string()).optional().refine(
    (patterns) => !patterns || patterns.every(pattern => PatternMatcher.validatePattern(pattern).valid),
    { message: "Invalid pattern format. Use glob patterns (*/docs/*), regex patterns (/api\\/v[0-9]+\\/.*/) or plain strings." }
  ),
  ignore_patterns: z.array(z.string()).optional().refine(
    (patterns) => !patterns || patterns.every(pattern => PatternMatcher.validatePattern(pattern).valid),
    { message: "Invalid pattern format. Use glob patterns (*/private/*), regex patterns (/login|admin/) or plain strings." }
  ),
  include_subdomains: z.boolean().default(false),
  force_refresh: z.boolean().default(false),
  agent_id: z.string().optional()
});

const GetScrapingStatusSchema = z.object({
  source_id: z.string().optional(),
  include_job_details: z.boolean().default(true)
});

const CancelScrapeJobSchema = z.object({
  job_id: z.string()
});

const StartScrapingWorkerSchema = z.object({
  max_concurrent_jobs: z.number().int().min(1).max(10).default(2),
  poll_interval_ms: z.number().int().min(1000).max(30000).default(5000)
});

export class WebScrapingMcpTools {
  constructor(
    private webScrapingService: WebScrapingService,
    private memoryService: MemoryService,
    private repositoryPath: string
  ) {}

  /**
   * Get all web scraping related MCP tools
   */
  getTools(): Tool[] {
    return [
      {
        name: 'scrape_documentation',
        description: 'Scrape documentation from a website using intelligent sub-agents',
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
            crawl_depth: {
              type: 'number',
              minimum: 1,
              maximum: 10,
              default: 3,
              description: 'Maximum depth to crawl from the base URL'
            },
            selectors: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'CSS selectors for extracting specific content (e.g., {"title": "h1", "content": ".main-content"})'
            },
            allow_patterns: {
              type: 'array',
              items: { type: 'string' },
              description: 'URL patterns to include during crawling (allowlist). Supports glob patterns (*/docs/*), regex patterns (/api\\/v[0-9]+\\/.*/) or plain strings.'
            },
            ignore_patterns: {
              type: 'array',
              items: { type: 'string' },
              description: 'URL patterns to ignore during crawling (blocklist). Supports glob patterns (*/private/*), regex patterns (/login|admin/) or plain strings.'
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
            }
          },
          required: ['url']
        }
      },
      {
        name: 'get_scraping_status',
        description: 'Get status of active and recent scraping jobs',
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
        }
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
        }
      },
      {
        name: 'start_scraping_worker',
        description: 'Start the background scraping worker to process queued jobs',
        inputSchema: {
          type: 'object',
          properties: {
            max_concurrent_jobs: {
              type: 'number',
              minimum: 1,
              maximum: 10,
              default: 2,
              description: 'Maximum number of concurrent scraping jobs'
            },
            poll_interval_ms: {
              type: 'number',
              minimum: 1000,
              maximum: 30000,
              default: 5000,
              description: 'Polling interval for checking new jobs (milliseconds)'
            }
          },
          required: []
        }
      },
      {
        name: 'stop_scraping_worker',
        description: 'Stop the background scraping worker',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
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
        }
      }
    ];
  }

  /**
   * Handle MCP tool calls for web scraping functionality
   */
  async handleToolCall(name: string, arguments_: any): Promise<any> {
    try {
      switch (name) {
        case 'scrape_documentation':
          return await this.scrapeDocumentation(arguments_);
        
        case 'get_scraping_status':
          return await this.getScrapingStatus(arguments_);
        
        case 'cancel_scrape_job':
          return await this.cancelScrapeJob(arguments_);
        
        case 'start_scraping_worker':
          return await this.startScrapingWorker(arguments_);
        
        case 'stop_scraping_worker':
          return await this.stopScrapingWorker();
        
        case 'list_documentation_sources':
          return await this.listDocumentationSources(arguments_);
        
        default:
          throw new Error(`Unknown web scraping tool: ${name}`);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  private async scrapeDocumentation(args: any) {
    const params = ScrapeDocumentationSchema.parse(args);
    
    // Validate patterns and provide helpful error messages
    if (params.allow_patterns) {
      const invalidPatterns = params.allow_patterns.filter(pattern => 
        !PatternMatcher.validatePattern(pattern).valid
      );
      if (invalidPatterns.length > 0) {
        return {
          success: false,
          error: `Invalid allow patterns: ${invalidPatterns.join(', ')}. ${PatternMatcher.getPatternDocumentation()}`
        };
      }
    }
    
    if (params.ignore_patterns) {
      const invalidPatterns = params.ignore_patterns.filter(pattern => 
        !PatternMatcher.validatePattern(pattern).valid
      );
      if (invalidPatterns.length > 0) {
        return {
          success: false,
          error: `Invalid ignore patterns: ${invalidPatterns.join(', ')}. ${PatternMatcher.getPatternDocumentation()}`
        };
      }
    }
    
    // Create documentation source if it doesn't exist
    const sourceId = await this.getOrCreateDocumentationSource(params);
    
    // Queue the scraping job
    const result = await this.webScrapingService.queueScrapeJob(
      sourceId,
      {
        sourceUrl: params.url,
        sourceName: params.name || new URL(params.url).hostname,
        crawlDepth: params.crawl_depth,
        selectors: params.selectors,
        allowPatterns: params.allow_patterns,
        ignorePatterns: params.ignore_patterns,
        includeSubdomains: params.include_subdomains,
        forceRefresh: params.force_refresh,
        agentId: params.agent_id
      },
      5 // Default priority
    );

    if (result.success && params.agent_id) {
      await this.memoryService.storeMemory(
        this.repositoryPath,
        params.agent_id,
        'shared',
        `Documentation scraping queued`,
        `Queued scraping for ${params.name || params.url} - Job ID: ${result.jobId}`
      );
    }

    return {
      ...result,
      source_id: sourceId,
      source_url: params.url,
      source_name: params.name || new URL(params.url).hostname,
      crawl_depth: params.crawl_depth,
      message: result.success 
        ? `Scraping job ${result.skipped ? 'already exists' : 'queued'} for ${params.name || params.url}`
        : `Failed to queue scraping job: ${result.error}`
    };
  }

  private async getScrapingStatus(args: any) {
    const params = GetScrapingStatusSchema.parse(args);
    
    const status = await this.webScrapingService.getScrapingStatus(params.source_id);
    
    if (!params.include_job_details) {
      return {
        success: true,
        summary: {
          activeJobs: status.activeJobs.length,
          pendingJobs: status.pendingJobs.length,
          completedJobs: status.completedJobs.length,
          failedJobs: status.failedJobs.length
        },
        workerStatus: status.workerStatus
      };
    }

    return {
      success: true,
      ...status,
      source_id: params.source_id
    };
  }

  private async cancelScrapeJob(args: any) {
    const params = CancelScrapeJobSchema.parse(args);
    
    const result = await this.webScrapingService.cancelScrapeJob(params.job_id);
    
    return {
      ...result,
      job_id: params.job_id,
      message: result.success 
        ? `Scraping job ${params.job_id} cancelled successfully`
        : `Failed to cancel job: ${result.error}`
    };
  }

  private async startScrapingWorker(args: any) {
    const params = StartScrapingWorkerSchema.parse(args);
    
    try {
      // Update worker configuration
      if (this.webScrapingService['workerConfig']) {
        this.webScrapingService['workerConfig'].maxConcurrentJobs = params.max_concurrent_jobs;
        this.webScrapingService['workerConfig'].pollIntervalMs = params.poll_interval_ms;
      }

      // Start the worker (non-blocking)
      this.webScrapingService.startScrapingWorker().catch(console.error);
      
      return {
        success: true,
        message: 'Scraping worker started successfully',
        config: {
          max_concurrent_jobs: params.max_concurrent_jobs,
          poll_interval_ms: params.poll_interval_ms
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start scraping worker'
      };
    }
  }

  private async stopScrapingWorker() {
    try {
      await this.webScrapingService.stopScrapingWorker();
      
      return {
        success: true,
        message: 'Scraping worker stopped successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop scraping worker'
      };
    }
  }

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
    return this.webScrapingService.getOrCreateDocumentationSource({
      url: params.url,
      name: params.name,
      sourceType: params.source_type,
      crawlDepth: params.crawl_depth,
      selectors: params.selectors,
      allowPatterns: params.allow_patterns,
      ignorePatterns: params.ignore_patterns,
      includeSubdomains: params.include_subdomains
    });
  }
}