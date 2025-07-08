/**
 * Web scraping service using background job queue with enhanced crawling
 * Direct scraping implementation with dropdown expansion and dynamic content loading
 */

import { randomBytes, createHash } from 'crypto';
import { pathToFileURL } from 'url';
import { performance } from 'perf_hooks';
import TurndownService from 'turndown';
import type { Page } from 'patchright';
import type { DatabaseManager } from '../database/index.js';
import { VectorSearchService } from './VectorSearchService.js';
import { domainBrowserManager } from './DomainBrowserManager.js';
import { BrowserManager } from './BrowserManager.js';
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
    private repositoryPath: string
  ) {
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
      linkStyle: 'inlined',
      linkReferenceStyle: 'full',
      bulletListMarker: '-',
      preformattedCode: true
    });
    
    // Add custom rules for better content extraction
    this.turndownService.addRule('preserveTableStructure', {
      filter: 'table',
      replacement: function(content) {
        return '\n\n' + content + '\n\n';
      }
    });
    
    this.turndownService.addRule('preserveCodeBlocks', {
      filter: ['pre', 'code'],
      replacement: function(content, node) {
        if (node.nodeName === 'PRE') {
          return '\n\n```\n' + content + '\n```\n\n';
        }
        return '`' + content + '`';
      }
    });
    
    this.turndownService.addRule('preserveListItems', {
      filter: 'li',
      replacement: function(content, node) {
        content = content.replace(/^\n+/, '').replace(/\n+$/, '\n');
        return '- ' + content;
      }
    });
    
    // Log constructor parameters for debugging
    this.logger.info('WebScrapingService initialized', {
      repositoryPath: this.repositoryPath,
      repositoryPathType: typeof this.repositoryPath,
      repositoryPathLength: this.repositoryPath?.length,
      repositoryPathTruthy: !!this.repositoryPath,
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

      // Log job creation
      this.logger.info(`Scraping job queued: ${jobId}`, {
        sourceName: jobParams.sourceName,
        sourceUrl: jobParams.sourceUrl,
        agentId: jobParams.agentId
      });

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
    await domainBrowserManager.cleanupAllDomains(true);
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

      // Process job directly using enhanced scraping
      await this.processJobDirectly(job, jobParams);

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
   * Process job directly using domain-aware browser managers with crawling
   */
  private async processJobDirectly(job: any, jobParams: ScrapeJobParams): Promise<void> {
    process.stderr.write(`🔧 Processing scraping job directly: ${job.id}\n`);

    // Get domain-specific browser
    const { browser } = await domainBrowserManager.getBrowserForDomain(jobParams.sourceUrl, job.sourceId);
    let page: Page | null = null;
    let pagesScraped = 0;
    let entriesCreated = 0;

    try {
      // Create a new page for this job
      page = await browser.newPage();
      
      // Get or create website for this domain
      const domain = this.websiteRepository.extractDomainFromUrl(jobParams.sourceUrl);
      const website = await this.websiteRepository.findOrCreateByDomain(domain, {
        name: jobParams.sourceName || domain,
        metaDescription: `Documentation for ${domain}`
      });

      // Initialize crawling queue with initial URL
      const crawlQueue: Array<{url: string, depth: number}> = [{
        url: jobParams.sourceUrl,
        depth: 0
      }];
      const processedUrls = new Set<string>();
      const maxDepth = jobParams.crawlDepth || 1;

      this.logger.info(`Starting crawl for ${jobParams.sourceName} with max depth ${maxDepth}`);

      while (crawlQueue.length > 0 && pagesScraped < 100) { // Safety limit
        const { url, depth } = crawlQueue.shift()!;
        
        // Skip if already processed
        if (processedUrls.has(url)) {
          this.logger.debug(`Skipping already processed URL: ${url}`);
          continue;
        }
        
        // Skip if depth exceeded
        if (depth > maxDepth) {
          this.logger.debug(`Skipping URL due to depth limit (${depth} > ${maxDepth}): ${url}`);
          continue;
        }

        this.logger.info(`Processing URL (depth ${depth}): ${url} (${crawlQueue.length} URLs remaining in queue)`);
        
        const processingStart = performance.now();

        // Apply URL filtering if patterns are specified
        if (jobParams.allowPatterns?.length || jobParams.ignorePatterns?.length) {
          const urlCheck = PatternMatcher.shouldAllowUrl(
            url,
            jobParams.allowPatterns,
            jobParams.ignorePatterns
          );
          
          if (!urlCheck.allowed) {
            process.stderr.write(`🚫 URL blocked by pattern: ${url} - ${urlCheck.reason}\n`);
            processedUrls.add(url);
            continue;
          } else {
            process.stderr.write(`✅ URL allowed: ${url} - ${urlCheck.reason}\n`);
          }
        }

        try {
          // Navigate to the URL
          const navigationSuccess = await browser.navigateToUrl(page, url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
          });

          if (!navigationSuccess) {
            this.logger.warn(`Failed to navigate to ${url}`);
            processedUrls.add(url);
            continue;
          }

          // Wait for page to fully load and expand navigation elements
          await this.expandNavigationElements(page, url);

          // Extract page content
          const pageContent = await browser.extractPageContent(page);
          let htmlContent = '';
          let markdownContent = '';
          let usedSelectors = false;

          // Apply selector-based extraction if provided
          if (jobParams.selectors && Object.keys(jobParams.selectors).length > 0) {
            const selectorResults: Record<string, string> = {};
            
            for (const [key, selector] of Object.entries(jobParams.selectors)) {
              const extractedText = await browser.extractText(page, selector);
              if (extractedText && extractedText.trim().length > 0) {
                selectorResults[key] = extractedText.trim();
              }
            }
            
            // Check if selector-based extraction yielded meaningful content
            const totalSelectorContent = Object.values(selectorResults).join('').trim();
            const hasValidSelectorContent = totalSelectorContent.length > 100; // Minimum threshold for meaningful content
            
            if (hasValidSelectorContent) {
              // Convert selector results to HTML and markdown
              htmlContent = Object.entries(selectorResults)
                .map(([key, value]) => `<section data-selector="${key}">${value}</section>`)
                .join('\n');
              markdownContent = Object.entries(selectorResults)
                .map(([key, value]) => `## ${key}\n\n${value}`)
                .join('\n\n');
              usedSelectors = true;
              
              this.logger.info(`Used selector-based extraction for ${url}, content length: ${totalSelectorContent.length}`);
            } else {
              this.logger.warn(`Selector-based extraction yielded insufficient content for ${url} (${totalSelectorContent.length} chars), falling back to full page`);
            }
          }
          
          // Fallback to full page content if selectors weren't used or failed
          if (!usedSelectors) {
            htmlContent = await page.content();
            markdownContent = this.convertHtmlToMarkdown(htmlContent);
            
            this.logger.info(`Used full page extraction for ${url}, markdown length: ${markdownContent.length}`);
          }

          // Normalize URL for consistent storage
          const normalizedUrl = this.websitePagesRepository.normalizeUrl(url);
          const contentHash = this.websitePagesRepository.generateContentHash(markdownContent);
          
          // Create or update website page
          const pageResult = await this.websitePagesRepository.createOrUpdate({
            id: `page_${Date.now()}_${randomBytes(8).toString('hex')}`,
            websiteId: website.id,
            url: normalizedUrl,
            contentHash,
            htmlContent,
            markdownContent,
            selector: jobParams.selectors ? JSON.stringify(jobParams.selectors) : undefined,
            title: pageContent.title || new URL(url).pathname,
            httpStatus: 200
          });

          if (pageResult.isNew) {
            // Add to vector collection for semantic search
            await this.addToVectorCollection(pageResult.page.id, markdownContent, {
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
          processedUrls.add(url);

          // Add internal links to crawl queue if we haven't reached max depth
          if (depth < maxDepth) {
            const internalLinks = browser.filterInternalLinks(
              pageContent.links, 
              jobParams.sourceUrl, 
              jobParams.includeSubdomains || false
            );
            
            // Apply pattern filtering to discovered links before adding to queue
            const filteredLinks = internalLinks.filter(link => {
              if (jobParams.allowPatterns?.length || jobParams.ignorePatterns?.length) {
                const urlCheck = PatternMatcher.shouldAllowUrl(
                  link,
                  jobParams.allowPatterns,
                  jobParams.ignorePatterns
                );
                return urlCheck.allowed;
              }
              return true;
            });
            
            for (const link of filteredLinks) {
              if (!processedUrls.has(link) && !crawlQueue.find(item => item.url === link)) {
                crawlQueue.push({ url: link, depth: depth + 1 });
                this.logger.debug(`Added to crawl queue: ${link} (depth ${depth + 1})`);
              }
            }
            
            this.logger.info(`Discovered ${filteredLinks.length} new links at depth ${depth} for ${url}`);
          }

        } catch (error) {
          this.logger.error(`Failed to process page ${url}`, error);
          processedUrls.add(url);
          continue;
        }
        
        const processingTime = performance.now() - processingStart;
        this.logger.info(`Completed processing ${url} in ${processingTime.toFixed(2)}ms`);
      }

      // Log final crawl summary
      this.logger.info(`Crawl completed for ${jobParams.sourceName}:`, {
        pagesScraped,
        entriesCreated,
        maxDepth,
        processedUrls: Array.from(processedUrls),
        remainingInQueue: crawlQueue.length,
        totalProcessed: processedUrls.size
      });

      // Update job results
      await this.scrapeJobRepository.update(job.id, {
        pagesScraped: pagesScraped,
        resultData: {
          processing_method: 'direct',
          pages_scraped: pagesScraped,
          entries_created: entriesCreated,
          max_depth: maxDepth,
          processed_urls: Array.from(processedUrls),
          remaining_in_queue: crawlQueue.length,
          total_discovered: processedUrls.size + crawlQueue.length,
          completed_at: new Date().toISOString()
        }
      });

    } finally {
      // Clean up page
      if (page) {
        try {
          await page.close();
        } catch (error) {
          this.logger.warn('Failed to close page', error);
        }
      }
      
      // Release browser for this source
      await domainBrowserManager.releaseBrowserForSource(jobParams.sourceUrl, job.sourceId);
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
      // Clean up the HTML first - be more selective to preserve content
      const cleanHtml = htmlContent
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove styles
        .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '') // Remove noscript
        .replace(/<!--[\s\S]*?-->/g, '') // Remove HTML comments
        // Only remove navigation if it's clearly marked as such
        .replace(/<nav[^>]*class="[^"]*nav[^"]*"[^>]*>[\s\S]*?<\/nav>/gi, '') // Remove navigation with nav class
        .replace(/<div[^>]*class="[^"]*sidebar[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '') // Remove sidebars
        .replace(/<div[^>]*class="[^"]*menu[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '') // Remove menus
        // Preserve main content areas
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();

      // Convert to Markdown with better configuration
      const markdown = this.turndownService.turndown(cleanHtml);
      
      // Clean up the markdown more carefully
      const cleanMarkdown = markdown
        .replace(/\n\s*\n\s*\n/g, '\n\n') // Remove excessive newlines
        .replace(/^\s+|\s+$/gm, '') // Trim each line
        .replace(/\[([^\]]+)\]\(\)/g, '$1') // Remove empty links
        .replace(/\*\*\s*\*\*/g, '') // Remove empty bold
        .replace(/__\s*__/g, '') // Remove empty italic
        .replace(/\n\n\n+/g, '\n\n') // Ensure max 2 consecutive newlines
        .trim();

      // Ensure we have meaningful content
      if (cleanMarkdown.length < 100) {
        this.logger.warn(`Markdown conversion resulted in short content (${cleanMarkdown.length} chars), trying with less aggressive cleaning`);
        
        // Try with less aggressive cleaning
        const lessAggressiveClean = htmlContent
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        
        const fallbackMarkdown = this.turndownService.turndown(lessAggressiveClean);
        return fallbackMarkdown.trim();
      }

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
   * Expand navigation elements and wait for dynamic content to load
   */
  private async expandNavigationElements(page: Page, url: string): Promise<void> {
    try {
      this.logger.info(`Expanding navigation elements for ${url}`);
      
      // Wait for initial page load to complete
      await page.waitForTimeout(2000);
      
      // Try to expand dropdowns and collapsible menus
      const expandableSelectors = [
        // Common dropdown triggers
        'button[aria-expanded="false"]',
        'button[aria-haspopup="menu"]',
        'button[aria-haspopup="true"]',
        '.dropdown-toggle',
        '.nav-toggle',
        '.menu-toggle',
        '.sidebar-toggle',
        
        // Common collapsible elements
        '.collapsible',
        '.accordion-trigger',
        '.expand-trigger',
        '[data-toggle="collapse"]',
        '[data-toggle="dropdown"]',
        
        // Framework-specific patterns
        '.v-expansion-panel-header', // Vuetify
        '.mat-expansion-panel-header', // Angular Material
        '.ant-collapse-header', // Ant Design
        '.bp3-collapse-header', // Blueprint
        
        // Generic patterns
        '[role="button"][aria-expanded="false"]',
        'details summary',
        '.show-more',
        '.expand-all',
        '.nav-expand'
      ];

      for (const selector of expandableSelectors) {
        try {
          // Find all elements matching this selector
          const elements = await page.$$eval(selector, (elements) => {
            return elements.map((el, index) => ({
              index,
              isVisible: (el as HTMLElement).offsetWidth > 0 && (el as HTMLElement).offsetHeight > 0,
              text: el.textContent?.trim() || '',
              ariaExpanded: el.getAttribute('aria-expanded'),
              tagName: el.tagName.toLowerCase()
            }));
          });

          if (elements.length > 0) {
            this.logger.info(`Found ${elements.length} expandable elements for selector: ${selector}`);
            
            // Click each expandable element
            for (const element of elements) {
              if (element.isVisible) {
                try {
                  await page.click(`${selector}:nth-child(${element.index + 1})`, { timeout: 5000 });
                  this.logger.debug(`Clicked expandable element: ${element.text.substring(0, 50)}...`);
                  
                  // Wait for potential animation/loading
                  await page.waitForTimeout(1000);
                } catch (clickError) {
                  this.logger.debug(`Failed to click element at index ${element.index}: ${clickError}`);
                }
              }
            }
          }
        } catch (error) {
          // Continue with next selector if this one fails
          this.logger.debug(`Failed to process selector ${selector}: ${error}`);
        }
      }

      // Wait for any dynamically loaded content
      await page.waitForTimeout(3000);
      
      // Try to load more content if "Load more" buttons exist
      const loadMoreSelectors = [
        'button:has-text("Load more")',
        'button:has-text("Show more")',
        'button:has-text("View more")',
        'button:has-text("See more")',
        '.load-more',
        '.show-more',
        '.view-more',
        '[data-testid="load-more"]',
        '[data-cy="load-more"]'
      ];

      for (const selector of loadMoreSelectors) {
        try {
          const loadMoreButton = await page.$(selector);
          if (loadMoreButton) {
            const isVisible = await loadMoreButton.isVisible();
            if (isVisible) {
              this.logger.info(`Found "Load more" button, clicking: ${selector}`);
              await loadMoreButton.click();
              
              // Wait for content to load
              await page.waitForTimeout(2000);
            }
          }
        } catch (error) {
          this.logger.debug(`Failed to click load more button ${selector}: ${error}`);
        }
      }

      // Scroll to bottom to trigger lazy loading
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      
      // Wait for lazy-loaded content
      await page.waitForTimeout(2000);
      
      // Scroll back to top
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      
      this.logger.info(`Completed navigation expansion for ${url}`);
      
    } catch (error) {
      this.logger.warn(`Failed to expand navigation elements for ${url}`, error);
      // Don't throw - continue with scraping even if expansion fails
    }
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