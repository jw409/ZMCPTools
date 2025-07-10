/**
 * BrowserService - Core browser automation and web scraping service
 * Provides unified browser session management, content extraction, and web interaction
 * Integrates with WebsiteRepository, WebsitePagesRepository, and LanceDBService
 */

import { DatabaseManager } from '../database/index.js';
import { WebsiteRepository } from '../repositories/WebsiteRepository.js';
import { WebsitePagesRepository } from '../repositories/WebsitePagesRepository.js';
import { LanceDBService } from './LanceDBService.js';
import { Logger } from '../utils/logger.js';
import type { 
  Website, 
  WebsitePage, 
  NewWebsite, 
  NewWebsitePage 
} from '../schemas/scraping.js';
import type { 
  VectorDocument, 
  VectorSearchResult 
} from './LanceDBService.js';

// ========== Core Configuration Interfaces ==========

export interface BrowserServiceConfig {
  headless?: boolean;
  timeout?: number;
  userAgent?: string;
  viewport?: {
    width: number;
    height: number;
  };
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
  sessionTimeout?: number;
  maxConcurrentSessions?: number;
  autoCloseIdleSessions?: boolean;
  idleSessionTimeout?: number;
  enableVectorIndexing?: boolean;
  vectorCollectionName?: string;
}

export interface BrowserSessionConfig {
  agentId?: string;
  sessionId?: string;
  persistSession?: boolean;
  autoClose?: boolean;
  workflowType?: 'automation' | 'testing' | 'documentation';
  metadata?: Record<string, any>;
}

export interface NavigationOptions {
  url: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
  headers?: Record<string, string>;
  cookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
  }>;
  retryCount?: number;
  retryDelay?: number;
}

export interface ExtractionConfig {
  extractText?: boolean;
  extractHtml?: boolean;
  extractLinks?: boolean;
  extractImages?: boolean;
  extractMetadata?: boolean;
  selector?: string;
  waitForSelector?: string;
  excludeSelectors?: string[];
  textProcessing?: {
    removeWhitespace?: boolean;
    extractKeywords?: boolean;
    generateSummary?: boolean;
  };
}

export interface InteractionAction {
  type: 'click' | 'type' | 'hover' | 'select' | 'screenshot' | 'wait' | 'scroll' | 'navigate';
  selector?: string;
  value?: string | string[];
  timeout?: number;
  filepath?: string;
  scrollBehavior?: 'auto' | 'smooth';
  waitCondition?: 'visible' | 'hidden' | 'stable' | 'networkidle';
  retryOnFailure?: boolean;
  metadata?: Record<string, any>;
}

export interface ScrapingOptions {
  baseUrl: string;
  maxPages?: number;
  allowPatterns?: string[];
  ignorePatterns?: string[];
  includeSubdomains?: boolean;
  respectRobotsTxt?: boolean;
  crawlDelay?: number;
  selectors?: string; // Plain string selector - CSS selector or JavaScript code
  followRedirects?: boolean;
  saveToDatabase?: boolean;
  enableVectorIndexing?: boolean;
  concurrentRequests?: number;
}

// ========== Response and Result Interfaces ==========

export interface ExtractedContent {
  text?: string;
  html?: string;
  markdown?: string;
  title?: string;
  url: string;
  links?: Array<{
    text: string;
    href: string;
    title?: string;
    type?: string;
  }>;
  images?: Array<{
    src: string;
    alt?: string;
    title?: string;
    width?: number;
    height?: number;
  }>;
  metadata?: {
    description?: string;
    keywords?: string[];
    author?: string;
    publishDate?: string;
    contentType?: string;
    charset?: string;
    canonical?: string;
  };
  httpStatus?: number;
  errorMessage?: string;
  extractedAt: string;
  processingTime?: number;
}

export interface BrowserSession {
  id: string;
  agentId?: string;
  browserType: 'chromium' | 'firefox' | 'webkit';
  createdAt: string;
  lastUsedAt: string;
  isActive: boolean;
  workflowType: 'automation' | 'testing' | 'documentation';
  metadata?: Record<string, any>;
  currentUrl?: string;
  pageTitle?: string;
  sessionTimeout: number;
  autoClose: boolean;
}

export interface InteractionResult {
  success: boolean;
  actionType: string;
  selector?: string;
  value?: string | string[];
  timestamp: string;
  processingTime: number;
  error?: string;
  screenshot?: string;
  metadata?: Record<string, any>;
}

export interface NavigationResult {
  success: boolean;
  url: string;
  finalUrl: string;
  title?: string;
  httpStatus?: number;
  loadTime: number;
  redirectChain?: string[];
  error?: string;
  metadata?: Record<string, any>;
}

export interface CrawlResult {
  websiteId: string;
  totalPages: number;
  successfulPages: number;
  failedPages: number;
  skippedPages: number;
  processingTime: number;
  errors: Array<{
    url: string;
    error: string;
    timestamp: string;
  }>;
  crawledUrls: string[];
  vectorIndexingEnabled: boolean;
  vectorDocumentsCreated?: number;
}

// ========== Error Handling Interfaces ==========

export interface BrowserError {
  type: 'navigation' | 'extraction' | 'interaction' | 'session' | 'timeout' | 'network';
  message: string;
  url?: string;
  selector?: string;
  sessionId?: string;
  timestamp: string;
  stack?: string;
  retryable: boolean;
  metadata?: Record<string, any>;
}

export interface SessionError {
  sessionId: string;
  error: BrowserError;
  recovery?: {
    attempted: boolean;
    successful: boolean;
    strategy: string;
  };
}

// ========== Service Response Interfaces ==========

export interface ServiceResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  errorType?: string;
  timestamp: string;
  processingTime?: number;
  metadata?: Record<string, any>;
}

export interface SessionManagementResult {
  sessionId: string;
  action: 'created' | 'reused' | 'closed' | 'cleaned';
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

export interface VectorIndexingResult {
  success: boolean;
  documentsIndexed: number;
  collectionName: string;
  vectorsCreated: number;
  error?: string;
  processingTime: number;
}

// ========== Supporting Classes ==========

/**
 * Domain-specific browser context management
 * Handles session persistence, cookies, and domain-specific configurations
 */
export class DomainBrowserContext {
  private domain: string;
  private sessions: Map<string, BrowserSession>;
  private logger: Logger;

  constructor(domain: string) {
    this.domain = domain;
    this.sessions = new Map();
    this.logger = new Logger(`browser-context-${domain}`);
  }

  async createSession(config: BrowserSessionConfig): Promise<BrowserSession> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async closeSession(sessionId: string): Promise<boolean> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async cleanupIdleSessions(): Promise<number> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  getDomain(): string {
    return this.domain;
  }

  getActiveSessions(): BrowserSession[] {
    return Array.from(this.sessions.values()).filter(session => session.isActive);
  }
}

/**
 * Content extraction engine
 * Handles text, HTML, and metadata extraction from web pages
 */
export class ContentExtractor {
  private logger: Logger;
  private defaultConfig: ExtractionConfig;

  constructor(defaultConfig: ExtractionConfig = {}) {
    this.logger = new Logger('content-extractor');
    this.defaultConfig = {
      extractText: true,
      extractHtml: false,
      extractLinks: false,
      extractImages: false,
      extractMetadata: true,
      textProcessing: {
        removeWhitespace: true,
        extractKeywords: false,
        generateSummary: false
      },
      ...defaultConfig
    };
  }

  async extractContent(
    page: any, // Browser page object
    config: ExtractionConfig = {}
  ): Promise<ExtractedContent> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async extractText(page: any, selector?: string): Promise<string> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async extractHtml(page: any, selector?: string): Promise<string> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async extractLinks(page: any): Promise<Array<{ text: string; href: string; title?: string; type?: string; }>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async extractImages(page: any): Promise<Array<{ src: string; alt?: string; title?: string; width?: number; height?: number; }>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async extractMetadata(page: any): Promise<Record<string, any>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  private processText(text: string, config: ExtractionConfig['textProcessing'] = {}): string {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  private generateContentHash(content: string): string {
    // Implementation placeholder
    throw new Error('Not implemented');
  }
}

/**
 * Web crawler engine
 * Handles systematic crawling of websites with respect to robots.txt and rate limits
 */
export class WebCrawler {
  private logger: Logger;
  private visitedUrls: Set<string>;
  private urlQueue: string[];
  private crawlStats: {
    totalPages: number;
    successfulPages: number;
    failedPages: number;
    skippedPages: number;
  };

  constructor() {
    this.logger = new Logger('web-crawler');
    this.visitedUrls = new Set();
    this.urlQueue = [];
    this.crawlStats = {
      totalPages: 0,
      successfulPages: 0,
      failedPages: 0,
      skippedPages: 0
    };
  }

  async crawl(
    session: BrowserSession,
    options: ScrapingOptions
  ): Promise<CrawlResult> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async shouldCrawlUrl(url: string, options: ScrapingOptions): Promise<boolean> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  private async checkRobotsTxt(baseUrl: string): Promise<boolean> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  private async extractUrlsFromPage(page: any, baseUrl: string): Promise<string[]> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  private matchesPatterns(url: string, patterns: string[]): boolean {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  private normalizeUrl(url: string, baseUrl: string): string {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  reset(): void {
    this.visitedUrls.clear();
    this.urlQueue = [];
    this.crawlStats = {
      totalPages: 0,
      successfulPages: 0,
      failedPages: 0,
      skippedPages: 0
    };
  }
}

/**
 * Session manager
 * Handles browser session lifecycle, cleanup, and resource management
 */
export class SessionManager {
  private sessions: Map<string, BrowserSession>;
  private domainContexts: Map<string, DomainBrowserContext>;
  private logger: Logger;
  private config: BrowserServiceConfig;

  constructor(config: BrowserServiceConfig) {
    this.sessions = new Map();
    this.domainContexts = new Map();
    this.logger = new Logger('session-manager');
    this.config = config;
  }

  async createSession(config: BrowserSessionConfig): Promise<ServiceResponse<BrowserSession>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async closeSession(sessionId: string, force: boolean = false): Promise<ServiceResponse<boolean>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async listSessions(filter?: {
    agentId?: string;
    workflowType?: string;
    isActive?: boolean;
  }): Promise<BrowserSession[]> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async cleanupIdleSessions(): Promise<ServiceResponse<number>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async getDomainContext(domain: string): Promise<DomainBrowserContext> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  private generateSessionId(): string {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  private extractDomainFromUrl(url: string): string {
    // Implementation placeholder
    throw new Error('Not implemented');
  }
}

// ========== Main BrowserService Class ==========

/**
 * Main BrowserService class
 * Provides unified interface for browser automation, web scraping, and content extraction
 */
export class BrowserService {
  private db: DatabaseManager;
  private websiteRepository: WebsiteRepository;
  private websitePagesRepository: WebsitePagesRepository;
  private lanceDBService: LanceDBService;
  private logger: Logger;
  private config: BrowserServiceConfig;

  // Core components
  private sessionManager: SessionManager;
  private contentExtractor: ContentExtractor;
  private webCrawler: WebCrawler;

  constructor(
    db: DatabaseManager,
    lanceDBService: LanceDBService,
    config: BrowserServiceConfig = {}
  ) {
    this.db = db;
    this.websiteRepository = new WebsiteRepository(db);
    this.websitePagesRepository = new WebsitePagesRepository(db);
    this.lanceDBService = lanceDBService;
    this.logger = new Logger('browser-service');

    // Set default configuration
    this.config = {
      headless: true,
      timeout: 30000,
      userAgent: 'Mozilla/5.0 (compatible; ClaudeMcpTools/1.0; +https://github.com/ClaudeMcpTools)',
      viewport: {
        width: 1920,
        height: 1080
      },
      sessionTimeout: 1800000, // 30 minutes
      maxConcurrentSessions: 10,
      autoCloseIdleSessions: true,
      idleSessionTimeout: 600000, // 10 minutes
      enableVectorIndexing: true,
      vectorCollectionName: 'scraped_content',
      ...config
    };

    // Initialize components
    this.sessionManager = new SessionManager(this.config);
    this.contentExtractor = new ContentExtractor();
    this.webCrawler = new WebCrawler();

    this.logger.info('BrowserService initialized', {
      config: this.config,
      vectorIndexingEnabled: this.config.enableVectorIndexing
    });
  }

  // ========== Session Management ==========

  async createSession(config: BrowserSessionConfig = {}): Promise<ServiceResponse<BrowserSession>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async getSession(sessionId: string): Promise<ServiceResponse<BrowserSession>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async closeSession(sessionId: string, force: boolean = false): Promise<ServiceResponse<boolean>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async listSessions(filter?: {
    agentId?: string;
    workflowType?: string;
    isActive?: boolean;
  }): Promise<ServiceResponse<BrowserSession[]>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async cleanupIdleSessions(): Promise<ServiceResponse<number>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  // ========== Navigation and Content Extraction ==========

  async navigateAndScrape(
    sessionId: string | null,
    options: NavigationOptions & ExtractionConfig
  ): Promise<ServiceResponse<ExtractedContent>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async navigate(
    sessionId: string,
    options: NavigationOptions
  ): Promise<ServiceResponse<NavigationResult>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async extractContent(
    sessionId: string,
    config: ExtractionConfig = {}
  ): Promise<ServiceResponse<ExtractedContent>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  // ========== Page Interaction ==========

  async interactWithPage(
    sessionId: string,
    actions: InteractionAction[]
  ): Promise<ServiceResponse<InteractionResult[]>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async takeScreenshot(
    sessionId: string,
    filepath?: string
  ): Promise<ServiceResponse<string>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async waitForSelector(
    sessionId: string,
    selector: string,
    timeout?: number
  ): Promise<ServiceResponse<boolean>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  // ========== Web Crawling and Scraping ==========

  async scrapeWebsite(
    options: ScrapingOptions & {
      agentId?: string;
      sessionId?: string;
    }
  ): Promise<ServiceResponse<CrawlResult>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async crawlAndIndex(
    options: ScrapingOptions & {
      collectionName?: string;
      enableVectorIndexing?: boolean;
    }
  ): Promise<ServiceResponse<CrawlResult & VectorIndexingResult>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  // ========== Database Integration ==========

  async saveToDatabase(
    content: ExtractedContent,
    websiteId?: string
  ): Promise<ServiceResponse<{ website: Website; page: WebsitePage; isNew: boolean }>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async getOrCreateWebsite(
    url: string,
    metadata?: Partial<NewWebsite>
  ): Promise<Website> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async updateWebsiteMetadata(
    websiteId: string,
    metadata: Partial<NewWebsite>
  ): Promise<ServiceResponse<Website>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  // ========== Vector Indexing ==========

  async indexContent(
    content: ExtractedContent,
    collectionName?: string
  ): Promise<ServiceResponse<VectorIndexingResult>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async searchSimilarContent(
    query: string,
    options: {
      collectionName?: string;
      limit?: number;
      threshold?: number;
      websiteId?: string;
    } = {}
  ): Promise<ServiceResponse<VectorSearchResult[]>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  // ========== Service Management ==========

  async getServiceStatus(): Promise<ServiceResponse<{
    activeSessions: number;
    totalSessions: number;
    activeContexts: number;
    vectorIndexingEnabled: boolean;
    databaseConnected: boolean;
    lastCleanup: string | null;
  }>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async getServiceStats(): Promise<ServiceResponse<{
    totalWebsites: number;
    totalPages: number;
    totalSessions: number;
    activeSessions: number;
    vectorCollections: number;
    averageResponseTime: number;
  }>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  async testService(): Promise<ServiceResponse<{
    browserConnection: boolean;
    databaseConnection: boolean;
    vectorIndexing: boolean;
    basicScraping: boolean;
  }>> {
    // Implementation placeholder
    throw new Error('Not implemented');
  }

  // ========== Error Handling and Recovery ==========

  private handleError(error: any, context: string): BrowserError {
    const browserError: BrowserError = {
      type: this.categorizeError(error),
      message: error.message || 'Unknown error occurred',
      timestamp: new Date().toISOString(),
      retryable: this.isRetryableError(error),
      metadata: {
        context,
        stack: error.stack
      }
    };

    this.logger.error(`Browser service error in ${context}`, browserError);
    return browserError;
  }

  private categorizeError(error: any): BrowserError['type'] {
    if (error.name === 'TimeoutError') return 'timeout';
    if (error.message?.includes('net::')) return 'network';
    if (error.message?.includes('navigation')) return 'navigation';
    if (error.message?.includes('selector')) return 'interaction';
    return 'session';
  }

  private isRetryableError(error: any): boolean {
    const retryableErrors = ['TimeoutError', 'NetworkError', 'ProtocolError'];
    return retryableErrors.some(errorType => error.name === errorType);
  }

  private async retryOperation<T>(
    operation: () => Promise<T>,
    retries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === retries || !this.isRetryableError(error)) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
      }
    }
    throw new Error('Max retries exceeded');
  }

  // ========== Cleanup and Shutdown ==========

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down BrowserService...');
    
    try {
      // Close all active sessions
      await this.sessionManager.cleanupIdleSessions();
      
      // Clear internal state
      this.logger.info('BrowserService shutdown complete');
    } catch (error) {
      this.logger.error('Error during BrowserService shutdown', error);
    }
  }
}

// ========== Utility Functions ==========

/**
 * URL normalization utility
 */
export function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    
    // Remove fragment
    urlObj.hash = '';
    
    // Remove common tracking parameters
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'ref', 'source', 'campaign_id', 'ad_id'
    ];
    
    trackingParams.forEach(param => {
      urlObj.searchParams.delete(param);
    });
    
    // Sort search params for consistency
    urlObj.searchParams.sort();
    
    // Remove trailing slash from pathname (except root)
    if (urlObj.pathname.length > 1 && urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }
    
    return urlObj.toString();
  } catch (error) {
    return url;
  }
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    // Fallback to basic string manipulation
    const match = url.match(/^https?:\/\/([^\/]+)/);
    return match ? match[1] : url;
  }
}

/**
 * Check if URL matches patterns (glob or regex)
 */
export function matchesPatterns(url: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) return true;

  return patterns.some(pattern => {
    // Check if pattern is a regex (starts and ends with /)
    if (pattern.startsWith('/') && pattern.endsWith('/')) {
      try {
        const regex = new RegExp(pattern.slice(1, -1));
        return regex.test(url);
      } catch (error) {
        return false;
      }
    }
    
    // Treat as glob pattern
    const globRegex = new RegExp(
      pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
    );
    
    return globRegex.test(url);
  });
}

/**
 * Generate content hash for deduplication
 */
export function generateContentHash(content: string): string {
  // Simple hash implementation - replace with crypto.createHash in production
  let hash = 0;
  if (content.length === 0) return hash.toString();
  
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return Math.abs(hash).toString(36);
}

/**
 * Validate URL format
 */
export function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

/**
 * Parse robots.txt content
 */
export function parseRobotsTxt(content: string, userAgent: string = '*'): {
  allowed: string[];
  disallowed: string[];
  crawlDelay?: number;
} {
  const result = {
    allowed: [],
    disallowed: [],
    crawlDelay: undefined
  };

  const lines = content.split('\n');
  let currentUserAgent = '';
  let isRelevantSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.toLowerCase().startsWith('user-agent:')) {
      currentUserAgent = trimmed.substring(11).trim();
      isRelevantSection = currentUserAgent === userAgent || currentUserAgent === '*';
      continue;
    }

    if (!isRelevantSection) continue;

    if (trimmed.toLowerCase().startsWith('allow:')) {
      result.allowed.push(trimmed.substring(6).trim());
    } else if (trimmed.toLowerCase().startsWith('disallow:')) {
      result.disallowed.push(trimmed.substring(9).trim());
    } else if (trimmed.toLowerCase().startsWith('crawl-delay:')) {
      const delay = parseInt(trimmed.substring(12).trim());
      if (!isNaN(delay)) {
        result.crawlDelay = delay * 1000; // Convert to milliseconds
      }
    }
  }

  return result;
}