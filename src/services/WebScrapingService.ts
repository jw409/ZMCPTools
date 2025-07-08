/**
 * Web scraping service using background sub-agents and job queue
 * TypeScript port of Python web_scraper.py with sub-agent integration
 */

import { randomBytes, createHash } from 'crypto';
import { pathToFileURL } from 'url';
import { performance } from 'perf_hooks';
import type { DatabaseManager } from '../database/index.js';
import type { AgentService } from './AgentService.js';
import type { MemoryService } from './MemoryService.js';
import { VectorSearchService } from './VectorSearchService.js';
import { BrowserTools } from '../tools/BrowserTools.js';
import { Logger } from '../utils/logger.js';

export interface ScrapeJobParams {
  force_refresh?: boolean;
  selectors?: Record<string, string>;
  crawl_depth?: number;
  allow_patterns?: string[];
  ignore_patterns?: string[];
  include_subdomains?: boolean;
  agent_id?: string;
  source_url: string;
  source_name: string;
}

export interface ScrapeJobResult {
  success: boolean;
  job_id?: string;
  pages_scraped?: number;
  documentation_entries_created?: number;
  error?: string;
  skipped?: boolean;
  reason?: string;
}

export interface ScrapingWorkerConfig {
  worker_id: string;
  max_concurrent_jobs: number;
  browser_pool_size: number;
  job_timeout_seconds: number;
  poll_interval_ms: number;
}

export class WebScrapingService {
  private browserTools: BrowserTools;
  private vectorSearchService: VectorSearchService;
  private isWorkerRunning = false;
  private workerConfig: ScrapingWorkerConfig;
  private logger: Logger;

  constructor(
    private db: DatabaseManager,
    private agentService: AgentService,
    private memoryService: MemoryService,
    private repositoryPath: string
  ) {
    this.browserTools = new BrowserTools(memoryService, repositoryPath);
    this.vectorSearchService = new VectorSearchService(this.db);
    this.logger = new Logger('webscraping');
    
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
      worker_id: `scraper_worker_${Date.now()}_${randomBytes(4).toString('hex')}`,
      max_concurrent_jobs: 2,
      browser_pool_size: 3,
      job_timeout_seconds: 3600,
      poll_interval_ms: 5000
    };
  }

  /**
   * Queue a scraping job for background processing
   */
  async queueScrapeJob(
    source_id: string,
    job_params: ScrapeJobParams,
    priority: number = 5
  ): Promise<ScrapeJobResult> {
    try {
      // Check for existing jobs
      const existing = this.db.database.prepare(`
        SELECT * FROM scrape_jobs 
        WHERE source_id = ? AND status IN ('PENDING', 'IN_PROGRESS') 
        LIMIT 1
      `).get(source_id);

      if (existing) {
        return {
          success: true,
          job_id: (existing as any).id,
          skipped: true,
          reason: 'Job already exists for this source'
        };
      }

      // Create new job
      const job_id = `scrape_job_${Date.now()}_${randomBytes(8).toString('hex')}`;
      
      this.db.database.prepare(`
        INSERT INTO scrape_jobs (id, source_id, job_data, status, created_at, lock_timeout)
        VALUES (?, ?, ?, ?, datetime('now'), ?)
      `).run(job_id, source_id, JSON.stringify(job_params), 'PENDING', this.workerConfig.job_timeout_seconds);

      // Store job info in memory for coordination
      await this.memoryService.storeMemory(
        this.repositoryPath,
        job_params.agent_id || 'system',
        'shared',
        `Scraping job queued: ${job_id}`,
        `Queued scraping job for ${job_params.source_name} (${job_params.source_url})`
      );

      return {
        success: true,
        job_id
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
    process.stderr.write(`🤖 Starting scraping worker: ${this.workerConfig.worker_id}\n`);

    // Main worker loop
    while (this.isWorkerRunning) {
      try {
        await this.processNextJob();
        await this.sleep(this.workerConfig.poll_interval_ms);
      } catch (error) {
        console.error('Worker error:', error);
        await this.sleep(this.workerConfig.poll_interval_ms * 2); // Back off on error
      }
    }
  }

  /**
   * Stop the background worker
   */
  async stopScrapingWorker(): Promise<void> {
    this.isWorkerRunning = false;
    await this.browserTools.shutdown();
    process.stderr.write(`🛑 Stopped scraping worker: ${this.workerConfig.worker_id}\n`);
  }

  /**
   * Process the next available job
   */
  private async processNextJob(): Promise<void> {
    // Find next available job
    const job = await this.acquireNextJob();
    if (!job) {
      return; // No jobs available
    }

    const startTime = performance.now();
    process.stderr.write(`🔄 Processing scrape job: ${job.id}\n`);

    try {
      // Parse job parameters
      const jobParams: ScrapeJobParams = JSON.parse(job.job_data);

      // Determine if we should use a sub-agent for complex scraping
      if (this.shouldUseSubAgent(jobParams)) {
        await this.processJobWithSubAgent(job, jobParams);
      } else {
        await this.processJobDirectly(job, jobParams);
      }

      // Mark job as completed
      this.db.database.prepare(`
        UPDATE scrape_jobs 
        SET status = 'COMPLETED', completed_at = datetime('now'), locked_by = NULL, locked_at = NULL
        WHERE id = ?
      `).run(job.id);

      const duration = performance.now() - startTime;
      process.stderr.write(`✅ Completed scrape job: ${job.id} (${duration.toFixed(2)}ms)\n`);

    } catch (error) {
      console.error(`❌ Failed scrape job: ${job.id}`, error);
      
      // Mark job as failed
      this.db.database.prepare(`
        UPDATE scrape_jobs 
        SET status = 'FAILED', completed_at = datetime('now'), error_message = ?, locked_by = NULL, locked_at = NULL
        WHERE id = ?
      `).run(error instanceof Error ? error.message : 'Unknown error', job.id);
    }
  }

  /**
   * Acquire and lock the next available job
   */
  private async acquireNextJob(): Promise<any | null> {
    const now = new Date();
    
    // Find jobs that are not locked or have expired locks
    const expiredTime = new Date(now.getTime() - this.workerConfig.job_timeout_seconds * 1000).toISOString();
    const jobs = this.db.database.prepare(`
      SELECT * FROM scrape_jobs 
      WHERE status = 'PENDING' 
        AND (locked_by IS NULL 
             OR locked_at IS NULL 
             OR locked_at < ?)
      ORDER BY created_at ASC 
      LIMIT 1
    `).all(expiredTime);

    if (jobs.length === 0) {
      return null;
    }

    const job = jobs[0];

    try {
      // Attempt to acquire lock
      const result = this.db.database.prepare(`
        UPDATE scrape_jobs 
        SET status = 'IN_PROGRESS', started_at = datetime('now'), locked_by = ?, locked_at = datetime('now')
        WHERE id = ?
      `).run(this.workerConfig.worker_id, (job as any).id);

      if (result.changes > 0) {
        return { ...(job as any), status: 'IN_PROGRESS', locked_by: this.workerConfig.worker_id };
      } else {
        return null;
      }
    } catch (error) {
      // Lock acquisition failed (race condition)
      return null;
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
    const hasDeepCrawling = (jobParams.crawl_depth || 1) > 2;
    const hasPatternFiltering = (jobParams.allow_patterns?.length || 0) > 0 || (jobParams.ignore_patterns?.length || 0) > 0;

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
SOURCE: ${jobParams.source_name} (${jobParams.source_url})
JOB ID: ${job.id}

You are an autonomous web scraping specialist with COMPLETE CLAUDE CODE CAPABILITIES.
Your task is to scrape and process documentation from the specified source.

CONFIGURATION:
- Crawl Depth: ${jobParams.crawl_depth || 3}
- Include Subdomains: ${jobParams.include_subdomains ? 'Yes' : 'No'}
- Force Refresh: ${jobParams.force_refresh ? 'Yes' : 'No'}
${jobParams.selectors ? `- Content Selectors: ${JSON.stringify(jobParams.selectors, null, 2)}` : ''}
${jobParams.allow_patterns ? `- Allow Patterns: ${JSON.stringify(jobParams.allow_patterns)}` : ''}
${jobParams.ignore_patterns ? `- Ignore Patterns: ${JSON.stringify(jobParams.ignore_patterns)}` : ''}

SCRAPING PROTOCOL:
1. CREATE BROWSER SESSION
   - Use create_browser_session with stealth settings
   - Set appropriate viewport and user agent
   
2. INTELLIGENT CRAWLING
   - Start with base URL: ${jobParams.source_url}
   - Follow same-domain links respecting patterns
   - Extract content using specified selectors
   - Respect robots.txt and rate limiting
   
3. CONTENT PROCESSING
   - Extract title, content, links, code examples
   - Clean and normalize extracted content
   - Generate content hashes for deduplication
   - Store in documentation_entries table
   
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
      sourceId: job.source_id,
      sourceUrl: jobParams.source_url
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
        source_id: job.source_id,
        source_url: jobParams.source_url,
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
      jobParams.agent_id || 'system',
      'shared',
      `Web scraping sub-agent spawned`,
      `Sub-agent ${subAgentResult.agentId} handling scraping job ${job.id} for ${jobParams.source_name}`
    );

    // Update job with sub-agent info
    this.db.database.prepare(`
      UPDATE scrape_jobs 
      SET result_data = ?
      WHERE id = ?
    `).run(JSON.stringify({
      sub_agent_id: subAgentResult.agentId,
      sub_agent_pid: subAgentResult.agent.claudePid,
      processing_method: 'sub_agent',
      started_at: new Date().toISOString()
    }), job.id);
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
      agentId: jobParams.agent_id
    });

    if (!browserResult.success) {
      throw new Error(`Failed to create browser session: ${browserResult.error}`);
    }

    const sessionId = browserResult.sessionId;
    let pagesScraped = 0;
    let entriesCreated = 0;

    try {
      // Navigate to source URL
      const navResult = await this.browserTools.navigateToUrl(sessionId, jobParams.source_url);
      if (!navResult.success) {
        throw new Error(`Failed to navigate to ${jobParams.source_url}: ${navResult.error}`);
      }

      // Scrape initial page
      const scrapeResult = await this.browserTools.scrapeContent(sessionId, {
        extractText: true,
        extractHtml: true,
        extractLinks: true,
        extractImages: false
      });

      if (scrapeResult.success && scrapeResult.content) {
        // Create documentation entry
        const entryId = `doc_entry_${Date.now()}_${randomBytes(8).toString('hex')}`;
        const contentText = scrapeResult.content.text || '';
        const contentHash = this.generateContentHash(contentText);
        
        // Store in documentation_entries table
        try {
          this.db.database.prepare(`
            INSERT OR REPLACE INTO documentation_entries (
              id, source_id, url, title, content, content_hash, 
              html_content, links, images, metadata, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          `).run(
            entryId,
            job.source_id,
            jobParams.source_url,
            new URL(jobParams.source_url).pathname,
            contentText,
            contentHash,
            scrapeResult.content.html || '',
            JSON.stringify(scrapeResult.content.links || []),
            JSON.stringify(scrapeResult.content.images || []),
            JSON.stringify({ scraped_at: new Date().toISOString() })
          );

          // Add to vector collection for semantic search
          await this.addToVectorCollection(entryId, contentText, {
            url: jobParams.source_url,
            title: new URL(jobParams.source_url).pathname,
            source_id: job.source_id,
            documentation_entry_id: entryId
          });

          this.logger.info(`Created documentation entry with vectorization: ${entryId}`);
        } catch (error) {
          this.logger.warn(`Failed to create documentation entry: ${entryId}`, error);
        }

        pagesScraped++;
        entriesCreated++;
      }

      // Update job results
      this.db.database.prepare(`
        UPDATE scrape_jobs 
        SET pages_scraped = ?, result_data = ?
        WHERE id = ?
      `).run(pagesScraped, JSON.stringify({
        processing_method: 'direct',
        pages_scraped: pagesScraped,
        entries_created: entriesCreated,
        completed_at: new Date().toISOString()
      }), job.id);

    } finally {
      // Clean up browser session
      await this.browserTools.closeBrowserSession(sessionId);
    }
  }

  /**
   * Get status of scraping jobs
   */
  async getScrapingStatus(source_id?: string): Promise<{
    active_jobs: any[];
    pending_jobs: any[];
    completed_jobs: any[];
    failed_jobs: any[];
    worker_status: {
      worker_id: string;
      is_running: boolean;
      config: ScrapingWorkerConfig;
    };
  }> {
    const whereClause = source_id ? { source_id } : {};

    const baseQuery = source_id ? 'WHERE source_id = ?' : '';
    const params = source_id ? [source_id] : [];
    
    const activeJobs = this.db.database.prepare(`
      SELECT * FROM scrape_jobs ${baseQuery} ${source_id ? 'AND' : 'WHERE'} status = 'IN_PROGRESS'
    `).all(...params);
    
    const pendingJobs = this.db.database.prepare(`
      SELECT * FROM scrape_jobs ${baseQuery} ${source_id ? 'AND' : 'WHERE'} status = 'PENDING'
    `).all(...params);
    
    const completedJobs = this.db.database.prepare(`
      SELECT * FROM scrape_jobs ${baseQuery} ${source_id ? 'AND' : 'WHERE'} status = 'COMPLETED' 
      ORDER BY completed_at DESC LIMIT 10
    `).all(...params);
    
    const failedJobs = this.db.database.prepare(`
      SELECT * FROM scrape_jobs ${baseQuery} ${source_id ? 'AND' : 'WHERE'} status = 'FAILED' 
      ORDER BY completed_at DESC LIMIT 10
    `).all(...params);

    return {
      active_jobs: activeJobs,
      pending_jobs: pendingJobs,
      completed_jobs: completedJobs,
      failed_jobs: failedJobs,
      worker_status: {
        worker_id: this.workerConfig.worker_id,
        is_running: this.isWorkerRunning,
        config: this.workerConfig
      }
    };
  }

  /**
   * Cancel a scraping job
   */
  async cancelScrapeJob(job_id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const job = this.db.database.prepare('SELECT * FROM scrape_jobs WHERE id = ?').get(job_id);
      if (!job) {
        return { success: false, error: 'Job not found' };
      }

      if ((job as any).status === 'COMPLETED' || (job as any).status === 'FAILED') {
        return { success: false, error: 'Job already finished' };
      }

      this.db.database.prepare(`
        UPDATE scrape_jobs 
        SET status = 'FAILED', completed_at = datetime('now'), error_message = 'Cancelled by user', locked_by = NULL, locked_at = NULL
        WHERE id = ?
      `).run(job_id);

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
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get or create a documentation source
   */
  getOrCreateDocumentationSource(params: {
    url: string;
    name?: string;
    source_type?: string;
    crawl_depth?: number;
    selectors?: Record<string, string>;
    allow_patterns?: string[];
    ignore_patterns?: string[];
    include_subdomains?: boolean;
  }): string {
    // Generate a source ID based on URL
    const urlHash = createHash('sha256').update(params.url).digest('hex').substring(0, 16);
    const sourceId = `source_${urlHash}`;
    
    // Check if source already exists
    const existing = this.db.database.prepare(
      'SELECT id FROM documentation_sources WHERE id = ?'
    ).get(sourceId);
    
    if (existing) {
      return sourceId;
    }
    
    // Create new documentation source
    this.db.database.prepare(`
      INSERT INTO documentation_sources (
        id, name, url, source_type, crawl_depth, selectors, 
        allow_patterns, ignore_patterns, include_subdomains, 
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOT_STARTED', datetime('now'), datetime('now'))
    `).run(
      sourceId,
      params.name || new URL(params.url).hostname,
      params.url,
      (params.source_type || 'guide').toUpperCase(),
      params.crawl_depth || 3,
      JSON.stringify(params.selectors || {}),
      JSON.stringify(params.allow_patterns || []),
      JSON.stringify(params.ignore_patterns || []),
      params.include_subdomains ? 1 : 0
    );
    
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

      // Determine collection name based on source
      const collectionName = metadata.source_id ? `source_${metadata.source_id}` : 'documentation';
      
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