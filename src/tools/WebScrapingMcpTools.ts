/**
 * MCP Tools for web scraping and documentation intelligence
 * Exposes sub-agent based scraping functionality through MCP protocol
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { WebScrapingService } from '../services/WebScrapingService.js';
import type { MemoryService } from '../services/MemoryService.js';

// Validation schemas
const ScrapeDocumentationSchema = z.object({
  url: z.string().url(),
  name: z.string().optional(),
  source_type: z.enum(['api', 'guide', 'reference', 'tutorial']).default('guide'),
  crawl_depth: z.number().int().min(1).max(10).default(3),
  selectors: z.record(z.string()).optional(),
  allow_patterns: z.array(z.string()).optional(),
  ignore_patterns: z.array(z.string()).optional(),
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
              description: 'URL patterns to include during crawling (allowlist)'
            },
            ignore_patterns: {
              type: 'array',
              items: { type: 'string' },
              description: 'URL patterns to ignore during crawling (blocklist)'
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
    
    // Create documentation source if it doesn't exist
    const sourceId = await this.getOrCreateDocumentationSource(params);
    
    // Queue the scraping job
    const result = await this.webScrapingService.queueScrapeJob(
      sourceId,
      {
        source_url: params.url,
        source_name: params.name || new URL(params.url).hostname,
        crawl_depth: params.crawl_depth,
        selectors: params.selectors,
        allow_patterns: params.allow_patterns,
        ignore_patterns: params.ignore_patterns,
        include_subdomains: params.include_subdomains,
        force_refresh: params.force_refresh,
        agent_id: params.agent_id
      },
      5 // Default priority
    );

    if (result.success && params.agent_id) {
      await this.memoryService.storeMemory(
        this.repositoryPath,
        params.agent_id,
        'shared',
        `Documentation scraping queued`,
        `Queued scraping for ${params.name || params.url} - Job ID: ${result.job_id}`
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
          active_jobs: status.active_jobs.length,
          pending_jobs: status.pending_jobs.length,
          completed_jobs: status.completed_jobs.length,
          failed_jobs: status.failed_jobs.length
        },
        worker_status: status.worker_status
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
        this.webScrapingService['workerConfig'].max_concurrent_jobs = params.max_concurrent_jobs;
        this.webScrapingService['workerConfig'].poll_interval_ms = params.poll_interval_ms;
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
      // This would integrate with DocumentationService in a real implementation
      // For now, return a placeholder response
      return {
        success: true,
        sources: [],
        total_sources: 0,
        message: 'Documentation sources listing - integration with DocumentationService needed'
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
    // Generate a source ID based on URL
    const crypto = require('crypto');
    const urlHash = crypto.createHash('sha256').update(params.url).digest('hex').substring(0, 16);
    const sourceId = `source_${urlHash}`;
    
    // In a real implementation, this would check if the source exists and create it if not
    // For now, return the generated ID
    return sourceId;
  }
}