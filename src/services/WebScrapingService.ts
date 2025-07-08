/**
 * Web scraping service using background sub-agents and job queue
 * TypeScript port of Python web_scraper.py with sub-agent integration
 */

import { randomBytes, createHash } from 'crypto';
import { pathToFileURL } from 'url';
import { performance } from 'perf_hooks';
import TurndownService from 'turndown';
import type { DatabaseManager } from '../database/index.js';
import type { AgentService } from './AgentService.js';
import type { MemoryService } from './MemoryService.js';
import { VectorSearchService } from './VectorSearchService.js';
import { BrowserTools } from '../tools/BrowserTools.js';
import { Logger } from '../utils/logger.js';
import { PatternMatcher } from '../utils/patternMatcher.js';
import { ScrapeJobRepository } from '../repositories/ScrapeJobRepository.js';
import { DocumentationRepository } from '../repositories/DocumentationRepository.js';
import { WebsiteRepository } from '../repositories/WebsiteRepository.js';
import { WebsitePagesRepository } from '../repositories/WebsitePagesRepository.js';
import type { DocumentationSource } from '../lib.js';

export interface ScrapeJobParams {
  forceRefresh?: boolean;
  selectors?: Record<string, string>;
  crawlDepth?: number;
  allowPatterns?: string[];
  ignorePatterns?: string[];
  includeSubdomains?: boolean;
  agentId?: string;
  sourceUrl: string;
  sourceName: string;
}

export interface ScrapeJobResult {
  success: boolean;
  jobId?: string;
  pagesScraped?: number;
  entriesCreated?: number;
  error?: string;
  skipped?: boolean;
  reason?: string;
}

export interface ScrapingWorkerConfig {
  workerId: string;
  maxConcurrentJobs: number;
  browserPoolSize: number;
  jobTimeoutSeconds: number;
  pollIntervalMs: number;
}

export class WebScrapingService {
  private browserTools: BrowserTools;
  private vectorSearchService: VectorSearchService;
  private scrapeJobRepository: ScrapeJobRepository;
  private documentationRepository: DocumentationRepository;
  private websiteRepository: WebsiteRepository;
  private websitePagesRepository: WebsitePagesRepository;
  private isWorkerRunning = false;
  private workerConfig: ScrapingWorkerConfig;
  private logger: Logger;
  private turndownService: TurndownService;

  constructor(
    private db: DatabaseManager,
    private agentService: AgentService,
    private memoryService: MemoryService,
    private repositoryPath: string
  ) {
    this.browserTools = new BrowserTools(memoryService, repositoryPath);
    this.vectorSearchService = new VectorSearchService(this.db);
    this.scrapeJobRepository = new ScrapeJobRepository(this.db);
    this.documentationRepository = new DocumentationRepository(this.db);
    this.websiteRepository = new WebsiteRepository(this.db);
    this.websitePagesRepository = new WebsitePagesRepository(this.db);
    this.logger = new Logger('webscraping');
    
    // Initialize Turndown service for HTML to Markdown conversion
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      fence: '```',
      emDelimiter: '_',
      strongDelimiter: '**',
      linkStyle: 'inlined'
    });
    
    // Log constructor parameters for debugging
    this.logger.info('WebScrapingService initialized', {
      repositoryPath: this.repositoryPath,
      repositoryPathType: typeof this.repositoryPath,
      repositoryPathLength: this.repositoryPath?.length,
      repositoryPathTruthy: !!this.repositoryPath,
      hasAgentService: !!this.agentService,
      hasMemoryService: !!this.memoryService,
      hasDatabase: !!this.db
    });
    
    this.workerConfig = {
      workerId: `scraper_worker_${Date.now()}_${randomBytes(4).toString('hex')}`,
      maxConcurrentJobs: 2,
      browserPoolSize: 3,
      jobTimeoutSeconds: 3600,
      pollIntervalMs: 5000
    };
  }

  /**
   * Queue a scraping job for background processing
   */
  async queueScrapeJob(
    sourceId: string,
    jobParams: ScrapeJobParams,
    priority: number = 5
  ): Promise<ScrapeJobResult> {
    try {
      // Check for existing jobs
      const existingJobs = await this.scrapeJobRepository.findBySourceId(sourceId);
      const existing = existingJobs.find(job => 
        job.status === 'pending' || job.status === 'running'
      );

      if (existing) {
        return {
          success: true,
          jobId: existing.id,
          skipped: true,
          reason: 'Job already exists for this source'
        };
      }

      // Create new job
      const jobId = `scrape_job_${Date.now()}_${randomBytes(8).toString('hex')}`;
      
      const newJob = await this.scrapeJobRepository.create({
        id: jobId,
        sourceId: sourceId,
        jobData: jobParams,
        status: 'pending',
        priority: priority,
        lockTimeout: this.workerConfig.jobTimeoutSeconds,
      });

      if (!newJob) {
        throw new Error('Failed to create scrape job');
      }

      // Store job info in memory for coordination
      await this.memoryService.storeMemory(
        this.repositoryPath,
        jobParams.agentId || 'system',
        'shared',
        `Scraping job queued: ${jobId}`,
        `Queued scraping job for ${jobParams.sourceName} (${jobParams.sourceUrl})`
      );

      return {
        success: true,
        jobId
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to queue scrape job'
      };
    }
  }

  /**
   * Start background worker to process scraping jobs
   */
  async startScrapingWorker(): Promise<void> {
    if (this.isWorkerRunning) {
      return;
    }

    this.isWorkerRunning = true;
    process.stderr.write(`🤖 Starting scraping worker: ${this.workerConfig.workerId}\n`);

    // Main worker loop
    while (this.isWorkerRunning) {
      try {
        await this.processNextJob();
        await this.sleep(this.workerConfig.pollIntervalMs);
      } catch (error) {
        console.error('Worker error:', error);
        await this.sleep(this.workerConfig.pollIntervalMs * 2); // Back off on error
      }
    }
  }

  /**
   * Stop the background worker
   */
  async stopScrapingWorker(): Promise<void> {
    this.isWorkerRunning = false;
    await this.browserTools.shutdown();
    process.stderr.write(`🛑 Stopped scraping worker: ${this.workerConfig.workerId}\n`);
  }

  /**
   * Process the next available job
   */
  private async processNextJob(): Promise<void> {
    // Find next available job
    const job = await this.scrapeJobRepository.lockNextPendingJob(
      this.workerConfig.workerId,
      this.workerConfig.jobTimeoutSeconds
    );
    
    if (!job) {
      return; // No jobs available
    }

    const startTime = performance.now();
    process.stderr.write(`🔄 Processing scrape job: ${job.id}\n`);

    try {
      // Parse job parameters
      const jobParams: ScrapeJobParams = job.jobData as ScrapeJobParams;

      // Determine if we should use a sub-agent for complex scraping
      if (this.shouldUseSubAgent(jobParams)) {
        await this.processJobWithSubAgent(job, jobParams);
      } else {
        await this.processJobDirectly(job, jobParams);
      }

      // Mark job as completed
      await this.scrapeJobRepository.markCompleted(job.id, {
        processingMethod: 'completed',
        completedAt: new Date().toISOString()
      });

      const duration = performance.now() - startTime;
      process.stderr.write(`✅ Completed scrape job: ${job.id} (${duration.toFixed(2)}ms)\n`);

    } catch (error) {
      console.error(`❌ Failed scrape job: ${job.id}`, error);
      
      // Mark job as failed
      await this.scrapeJobRepository.markFailed(
        job.id,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }


  /**
   * Determine if job should use a sub-agent
   */
  private shouldUseSubAgent(jobParams: ScrapeJobParams): boolean {
    // Use sub-agent for complex scenarios:
    // 1. Deep crawling (depth > 2)
    // 2. Complex selectors
    // 3. Pattern-based filtering
    // 4. Multiple content types to extract

    const hasComplexSelectors = jobParams.selectors && Object.keys(jobParams.selectors).length > 3;
    const hasDeepCrawling = (jobParams.crawlDepth || 1) > 2;
    const hasPatternFiltering = (jobParams.allowPatterns?.length || 0) > 0 || (jobParams.ignorePatterns?.length || 0) > 0;

    return hasComplexSelectors || hasDeepCrawling || hasPatternFiltering;
  }

  /**
   * Process job using a specialized sub-agent
   */
  private async processJobWithSubAgent(job: any, jobParams: ScrapeJobParams): Promise<void> {
    process.stderr.write(`🤖 Spawning sub-agent for complex scraping job: ${job.id}\n`);

    // Create specialized web scraping sub-agent prompt
    const subAgentPrompt = `
🕷️ WEB SCRAPING SUB-AGENT - Specialized Documentation Crawler

MISSION: Complete web scraping task for documentation source
SOURCE: ${jobParams.sourceName} (${jobParams.sourceUrl})
JOB ID: ${job.id}

You are an autonomous web scraping specialist with COMPLETE CLAUDE CODE CAPABILITIES.
Your task is to scrape and process documentation from the specified source.

CONFIGURATION:
- Crawl Depth: ${jobParams.crawlDepth || 3}
- Include Subdomains: ${jobParams.includeSubdomains ? 'Yes' : 'No'}
- Force Refresh: ${jobParams.forceRefresh ? 'Yes' : 'No'}
${jobParams.selectors ? `- Content Selectors: ${JSON.stringify(jobParams.selectors, null, 2)}` : ''}
${jobParams.allowPatterns ? `- Allow Patterns: ${JSON.stringify(jobParams.allowPatterns)}` : ''}
${jobParams.ignorePatterns ? `- Ignore Patterns: ${JSON.stringify(jobParams.ignorePatterns)}` : ''}

SCRAPING PROTOCOL:
1. CREATE BROWSER SESSION
   - Use create_browser_session with stealth settings
   - Set appropriate viewport and user agent
   
2. INTELLIGENT CRAWLING
   - Start with base URL: ${jobParams.sourceUrl}
   - Follow same-domain links respecting patterns
   - Extract content using specified selectors
   - Respect robots.txt and rate limiting
   
3. CONTENT PROCESSING & URL FILTERING
   - Extract HTML content and convert to clean Markdown format
   - Process headers, links, code blocks, and lists properly
   - Remove navigation, scripts, styles, and boilerplate
   - Apply URL filtering using allow/ignore patterns:
     ${jobParams.allowPatterns?.length ? `   * Allow patterns: ${JSON.stringify(jobParams.allowPatterns)}` : ''}
     ${jobParams.ignorePatterns?.length ? `   * Ignore patterns: ${JSON.stringify(jobParams.ignorePatterns)}` : ''}
   - Generate content hashes for deduplication
   - Store in websites and website_pages tables with both HTML and Markdown
   
4. PROGRESS TRACKING
   - Update scrape job status regularly
   - Store insights in shared memory
   - Report pages scraped and entries created

AUTONOMOUS OPERATION:
- Use ALL available tools: browser automation, database, file operations
- Handle errors gracefully with retries
- Implement intelligent rate limiting
- Monitor for content changes
- Optimize for speed and accuracy

COMPLETION CRITERIA:
- All discoverable pages within crawl depth processed
- Documentation entries created with proper metadata
- Job marked as COMPLETED with statistics
- Results stored in shared memory

CRITICAL: You have full autonomy. Take any actions needed to complete the scraping successfully.
`;

    // Log spawn parameters for debugging
    this.logger.info(`Attempting to spawn sub-agent for job ${job.id}`, {
      agentName: `web_scraper_${job.id}`,
      repositoryPath: this.repositoryPath,
      repositoryPathType: typeof this.repositoryPath,
      repositoryPathLength: this.repositoryPath?.length,
      capabilities: ['browser_automation', 'database_access', 'file_operations'],
      jobId: job.id,
      sourceId: job.sourceId,
      sourceUrl: jobParams.sourceUrl
    });

    // Spawn the sub-agent
    const subAgentResult = await this.agentService.spawnAgent({
      agentName: `web_scraper_${job.id}`,
      repositoryPath: this.repositoryPath,
      prompt: subAgentPrompt,
      capabilities: ['browser_automation', 'database_access', 'file_operations'],
      agentMetadata: {
        job_id: job.id,
        job_type: 'web_scraping',
        sourceId: job.sourceId,
        sourceUrl: jobParams.sourceUrl,
        started_at: new Date().toISOString()
      }
    });

    // Log spawn result for debugging
    this.logger.info(`Sub-agent spawn result for job ${job.id}`, {
      success: !!subAgentResult.agentId,
      agentId: subAgentResult.agentId,
      hasAgent: !!subAgentResult.agent,
      agentPid: subAgentResult.agent?.claudePid,
      resultKeys: Object.keys(subAgentResult),
      repositoryPathUsed: this.repositoryPath
    });

    if (!subAgentResult.agentId) {
      const errorMessage = `Failed to spawn sub-agent for job ${job.id}. Repository path: ${this.repositoryPath} (type: ${typeof this.repositoryPath}). Spawn result: ${JSON.stringify(subAgentResult)}`;
      this.logger.error(errorMessage, {
        jobId: job.id,
        repositoryPath: this.repositoryPath,
        repositoryPathType: typeof this.repositoryPath,
        subAgentResult,
        spawnParameters: {
          agentName: `web_scraper_${job.id}`,
          repositoryPath: this.repositoryPath,
          capabilities: ['browser_automation', 'database_access', 'file_operations']
        }
      });
      throw new Error(errorMessage);
    }

    // Store sub-agent info
    await this.memoryService.storeMemory(
      this.repositoryPath,
      jobParams.agentId || 'system',
      'shared',
      `Web scraping sub-agent spawned`,
      `Sub-agent ${subAgentResult.agentId} handling scraping job ${job.id} for ${jobParams.sourceName}`
    );

    // Update job with sub-agent info
    await this.scrapeJobRepository.update(job.id, {
      resultData: {
        sub_agent_id: subAgentResult.agentId,
        sub_agent_pid: subAgentResult.agent.claudePid,
        processing_method: 'sub_agent',
        started_at: new Date().toISOString()
      }
    });
  }

  /**
   * Process job directly (for simple scraping tasks)
   */
  private async processJobDirectly(job: any, jobParams: ScrapeJobParams): Promise<void> {
    process.stderr.write(`🔧 Processing simple scraping job directly: ${job.id}\n`);

    // Create browser session
    const browserResult = await this.browserTools.createBrowserSession('chromium', {
      headless: true,
      viewport: { width: 1920, height: 1080 },
      agentId: jobParams.agentId
    });

    if (!browserResult.success) {
      throw new Error(`Failed to create browser session: ${browserResult.error}`);
    }

    const sessionId = browserResult.sessionId;
    let pagesScraped = 0;
    let entriesCreated = 0;

    try {
      // Navigate to source URL
      const navResult = await this.browserTools.navigateToUrl(sessionId, jobParams.sourceUrl);
      if (!navResult.success) {
        throw new Error(`Failed to navigate to ${jobParams.sourceUrl}: ${navResult.error}`);
      }

      // Scrape initial page
      const scrapeResult = await this.browserTools.scrapeContent(sessionId, {
        extractText: true,
        extractHtml: true,
        extractLinks: true,
        extractImages: false
      });

      // Apply URL filtering if patterns are specified
      if (jobParams.allowPatterns?.length || jobParams.ignorePatterns?.length) {
        const urlCheck = PatternMatcher.shouldAllowUrl(
          jobParams.sourceUrl,
          jobParams.allowPatterns,
          jobParams.ignorePatterns
        );
        
        if (!urlCheck.allowed) {
          process.stderr.write(`🚫 URL blocked by pattern: ${jobParams.sourceUrl} - ${urlCheck.reason}\n`);
          return; // Skip this page
        } else {
          process.stderr.write(`✅ URL allowed: ${jobParams.sourceUrl} - ${urlCheck.reason}\n`);
        }
      }

      if (scrapeResult.success && scrapeResult.content) {
        // Normalize URL for consistent storage
        const normalizedUrl = this.websitePagesRepository.normalizeUrl(jobParams.sourceUrl);
        
        // Get or create website for this domain
        const domain = this.websiteRepository.extractDomainFromUrl(jobParams.sourceUrl);
        const website = await this.websiteRepository.findOrCreateByDomain(domain, {
          name: jobParams.sourceName || domain,
          metaDescription: `Documentation for ${domain}`
        });
        
        // Convert HTML to Markdown for better text processing
        const htmlContent = scrapeResult.content.html || '';
        const markdownContent = htmlContent ? this.convertHtmlToMarkdown(htmlContent) : '';
        const contentText = markdownContent || scrapeResult.content.text || '';
        const contentHash = this.websitePagesRepository.generateContentHash(contentText);
        
        // Apply selector if provided
        let processedHtml = htmlContent;
        let processedMarkdown = markdownContent;
        
        if (jobParams.selectors && Object.keys(jobParams.selectors).length > 0) {
          // TODO: Apply selector-based extraction here
          // For now, using full content
        }
        
        // Create or update website page
        const pageResult = await this.websitePagesRepository.createOrUpdate({
          id: `page_${Date.now()}_${randomBytes(8).toString('hex')}`,
          websiteId: website.id,
          url: normalizedUrl,
          contentHash,
          htmlContent: processedHtml,
          markdownContent: processedMarkdown,
          selector: jobParams.selectors ? JSON.stringify(jobParams.selectors) : undefined,
          title: new URL(jobParams.sourceUrl).pathname,
          httpStatus: 200
        });

        if (pageResult.isNew) {
          // Add to vector collection for semantic search
          await this.addToVectorCollection(pageResult.page.id, processedMarkdown, {
            url: normalizedUrl,
            title: pageResult.page.title,
            websiteId: website.id,
            websiteName: website.name,
            domain: website.domain,
            pageId: pageResult.page.id
          });

          this.logger.info(`Created new website page with vectorization: ${pageResult.page.id}`);
          entriesCreated++;
        } else {
          this.logger.info(`Updated existing website page: ${pageResult.page.id}`);
        }

        pagesScraped++;
      }

      // Update job results
      await this.scrapeJobRepository.update(job.id, {
        pagesScraped: pagesScraped,
        resultData: {
          processing_method: 'direct',
          pages_scraped: pagesScraped,
          entries_created: entriesCreated,
          completed_at: new Date().toISOString()
        }
      });

    } finally {
      // Clean up browser session
      await this.browserTools.closeBrowserSession(sessionId);
    }
  }

  /**
   * Get status of scraping jobs
   */
  async getScrapingStatus(sourceId?: string): Promise<{
    activeJobs: any[];
    pendingJobs: any[];
    completedJobs: any[];
    failedJobs: any[];
    workerStatus: {
      workerId: string;
      isRunning: boolean;
      config: ScrapingWorkerConfig;
    };
  }> {
    const activeJobs = sourceId ? 
      await this.scrapeJobRepository.findBySourceId(sourceId).then(jobs => jobs.filter(j => j.status === 'running')) :
      await this.scrapeJobRepository.findByStatus('running');
    
    const pendingJobs = sourceId ? 
      await this.scrapeJobRepository.findBySourceId(sourceId).then(jobs => jobs.filter(j => j.status === 'pending')) :
      await this.scrapeJobRepository.findByStatus('pending');
    
    const completedJobs = sourceId ? 
      await this.scrapeJobRepository.findBySourceId(sourceId).then(jobs => jobs.filter(j => j.status === 'completed').slice(0, 10)) :
      await this.scrapeJobRepository.findByStatus('completed');
    
    const failedJobs = sourceId ? 
      await this.scrapeJobRepository.findBySourceId(sourceId).then(jobs => jobs.filter(j => j.status === 'failed').slice(0, 10)) :
      await this.scrapeJobRepository.findByStatus('failed');

    return {
      activeJobs,
      pendingJobs,
      completedJobs,
      failedJobs,
      workerStatus: {
        workerId: this.workerConfig.workerId,
        isRunning: this.isWorkerRunning,
        config: this.workerConfig
      }
    };
  }

  /**
   * Cancel a scraping job
   */
  async cancelScrapeJob(jobId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const job = await this.scrapeJobRepository.findById(jobId);
      if (!job) {
        return { success: false, error: 'Job not found' };
      }

      if (job.status === 'completed' || job.status === 'failed') {
        return { success: false, error: 'Job already finished' };
      }

      await this.scrapeJobRepository.cancelJob(jobId, 'Cancelled by user');

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to cancel job' 
      };
    }
  }

  /**
   * Generate content hash for deduplication
   */
  private generateContentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Normalize URL for consistent storage and deduplication
   */
  private normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      
      // Remove hash fragments
      urlObj.hash = '';
      
      // Remove common tracking parameters
      const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref'];
      trackingParams.forEach(param => {
        urlObj.searchParams.delete(param);
      });
      
      // Sort search parameters for consistency
      urlObj.searchParams.sort();
      
      // Remove trailing slash from pathname unless it's the root
      if (urlObj.pathname.length > 1 && urlObj.pathname.endsWith('/')) {
        urlObj.pathname = urlObj.pathname.slice(0, -1);
      }
      
      return urlObj.toString();
    } catch (error) {
      this.logger.warn(`Failed to normalize URL: ${url}`, error);
      return url;
    }
  }


  /**
   * Convert HTML content to clean Markdown format
   */
  private convertHtmlToMarkdown(htmlContent: string): string {
    try {
      // Clean up the HTML first
      const cleanHtml = htmlContent
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove styles
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '') // Remove navigation
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '') // Remove headers
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '') // Remove footers
        .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '') // Remove sidebars
        .replace(/<!--[\s\S]*?-->/g, '') // Remove HTML comments
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();

      // Convert to Markdown
      const markdown = this.turndownService.turndown(cleanHtml);
      
      // Clean up the markdown
      const cleanMarkdown = markdown
        .replace(/\n\s*\n\s*\n/g, '\n\n') // Remove excessive newlines
        .replace(/^\s+|\s+$/gm, '') // Trim each line
        .replace(/\[([^\]]+)\]\(\)/g, '$1') // Remove empty links
        .replace(/\*\*\s*\*\*/g, '') // Remove empty bold
        .replace(/__\s*__/g, '') // Remove empty italic
        .trim();

      return cleanMarkdown;
    } catch (error) {
      this.logger.warn('Failed to convert HTML to Markdown, using original content', error);
      return htmlContent;
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get or create a documentation source
   */
  async getOrCreateDocumentationSource(params: {
    url: string;
    name?: string;
    sourceType?: string;
    crawlDepth?: number;
    selectors?: Record<string, string>;
    allowPatterns?: string[];
    ignorePatterns?: string[];
    includeSubdomains?: boolean;
    updateFrequency?: DocumentationSource['updateFrequency'];
  }): Promise<string> {
    // Generate a source ID based on URL
    const urlHash = createHash('sha256').update(params.url).digest('hex').substring(0, 16);
    const sourceId = `source_${urlHash}`;
    
    // Check if source already exists
    const existing = await this.documentationRepository.findById(sourceId);
    
    if (existing) {
      return sourceId;
    }
    
    // Create new documentation source
    const newSource = await this.documentationRepository.create({
      id: sourceId,
      name: params.name || new URL(params.url).hostname,
      url: params.url,
      sourceType: (params.sourceType || 'guide') as any,
      crawlDepth: params.crawlDepth || 3,
      selectors: params.selectors || {},
      allowPatterns: params.allowPatterns || [],
      ignorePatterns: params.ignorePatterns || [],
      includeSubdomains: params.includeSubdomains || false,
      status: 'not_started',
      updateFrequency: params.updateFrequency || 'weekly',
    });
    
    if (!newSource) {
      throw new Error('Failed to create documentation source');
    }
    
    return sourceId;
  }

  /**
   * Add scraped content to vector collection for semantic search
   */
  private async addToVectorCollection(
    entryId: string, 
    content: string, 
    metadata: Record<string, any>
  ): Promise<void> {
    try {
      // Skip empty content
      if (!content || content.trim().length < 50) {
        this.logger.debug(`Skipping vectorization for short content: ${entryId}`);
        return;
      }

      // Determine collection name based on website
      const collectionName = metadata.websiteId ? `website_${metadata.websiteId}` : 'documentation';
      
      // Add to vector collection
      const result = await this.vectorSearchService.addDocuments(collectionName, [{
        id: entryId,
        content: content.trim(),
        metadata
      }]);

      if (result.success) {
        this.logger.info(`Added document to vector collection ${collectionName}: ${entryId}`);
      } else {
        this.logger.warn(`Failed to add document to vector collection: ${result.error}`);
      }

    } catch (error) {
      this.logger.error(`Vector collection addition failed for ${entryId}`, error);
      // Don't throw - vectorization failure shouldn't break scraping
    }
  }

  /**
   * Search scraped documentation using semantic similarity
   */
  async searchDocumentation(
    query: string, 
    options: {
      collection?: string;
      limit?: number;
      threshold?: number;
    } = {}
  ): Promise<{
    success: boolean;
    results?: Array<{
      id: string;
      content: string;
      url?: string;
      title?: string;
      similarity: number;
    }>;
    error?: string;
  }> {
    try {
      const {
        collection = 'documentation',
        limit = 10,
        threshold = 0.7
      } = options;

      const results = await this.vectorSearchService.searchSimilar(
        collection,
        query,
        limit,
        threshold
      );

      return {
        success: true,
        results: results.map(result => ({
          id: result.id,
          content: result.content,
          url: result.metadata?.url,
          title: result.metadata?.title,
          similarity: result.similarity
        }))
      };

    } catch (error) {
      this.logger.error('Documentation search failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Search failed'
      };
    }
  }

  /**
   * Get vector collection statistics
   */
  async getVectorStats(): Promise<{
    success: boolean;
    collections?: Array<{
      name: string;
      documentCount: number;
    }>;
    error?: string;
  }> {
    try {
      const collections = await this.vectorSearchService.listCollections();
      
      return {
        success: true,
        collections: collections.map(col => ({
          name: col.name,
          documentCount: col.count
        }))
      };

    } catch (error) {
      this.logger.error('Failed to get vector stats', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Stats failed'
      };
    }
  }
}