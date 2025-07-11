/**
 * BrowserTools.ts - Consolidated browser automation tools
 * Combines core browser automation (BrowserTools.ts) with MCP protocol integration (BrowserMcpTools.ts)
 * 
 * This class provides:
 * - Core browser automation using Patchright (stealth features, session management)
 * - MCP protocol integration for agent communication
 * - Intelligent session management with workflow-aware auto-close
 * - Consolidated tool interface (5 optimized tools)
 * - Legacy tool support for backward compatibility
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';
import { chromium, firefox, webkit } from 'patchright';
import type { Browser, Page, BrowserContext } from 'patchright';
import UserAgent from 'user-agents';
import type { KnowledgeGraphService } from '../services/KnowledgeGraphService.js';
import { MemoryService } from '../services/MemoryService.js';
import { BrowserOperationResponseSchema, createSuccessResponse, createErrorResponse, type BrowserOperationResponse } from '../schemas/toolResponses.js';
import {
  BrowserCreateSessionSchema,
  BrowserNavigateAndScrapeSchema,
  BrowserInteractWithPageSchema,
  BrowserManageSessionsSchema,
  BrowserLegacyNavigateSchema,
  BrowserLegacyScrapeSchema,
  BrowserScreenshotSchema,
  BrowserExecuteScriptSchema,
  BrowserInteractSchema
} from '../schemas/tools/browser.js';

/**
 * Generate realistic Chrome user agents for better browser fingerprinting
 */
class UserAgentGenerator {
  private static readonly CHROME_VERSIONS = [
    '131.0.0.0', '132.0.0.0', '133.0.0.0', '134.0.0.0', '135.0.0.0', '136.0.0.0', '137.0.0.0'
  ];

  private static readonly WINDOWS_VERSIONS = [
    'Windows NT 10.0; Win64; x64',
    'Windows NT 11.0; Win64; x64'
  ];

  private static readonly ANDROID_VERSIONS = [
    'Android 12', 'Android 13', 'Android 14', 'Android 15'
  ];

  private static readonly MOBILE_DEVICES = [
    'SM-G991B', 'SM-G998B', 'SM-S911B', 'SM-S918B', 'Pixel 6', 'Pixel 7', 'Pixel 8'
  ];

  static generateChromeUserAgent(deviceCategory: 'desktop' | 'mobile' = 'desktop'): string {
    const chromeVersion = this.CHROME_VERSIONS[Math.floor(Math.random() * this.CHROME_VERSIONS.length)];
    
    if (deviceCategory === 'mobile') {
      const androidVersion = this.ANDROID_VERSIONS[Math.floor(Math.random() * this.ANDROID_VERSIONS.length)];
      const device = this.MOBILE_DEVICES[Math.floor(Math.random() * this.MOBILE_DEVICES.length)];
      
      return `Mozilla/5.0 (Linux; ${androidVersion}; ${device}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Mobile Safari/537.36`;
    } else {
      const windowsVersion = this.WINDOWS_VERSIONS[Math.floor(Math.random() * this.WINDOWS_VERSIONS.length)];
      
      return `Mozilla/5.0 (${windowsVersion}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    }
  }
}

// Core browser session interface
export interface BrowserSession {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  browserType: 'chromium' | 'firefox' | 'webkit';
  createdAt: Date;
  lastUsed: Date;
  repositoryPath: string;
  agentId?: string;
}

// Session management schemas
const SessionConfigSchema = z.object({
  autoClose: z.boolean().optional(),
  sessionTimeout: z.number().optional(),
  workflowType: z.enum(['documentation', 'automation', 'testing']).optional(),
  maxIdleTime: z.number().optional()
});

const SessionMetadataSchema = z.object({
  sessionId: z.string(),
  workflowType: z.enum(['documentation', 'automation', 'testing']),
  autoClose: z.boolean(),
  createdAt: z.date(),
  lastActivity: z.date(),
  taskCompleted: z.boolean().optional()
});

// Export inferred types
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

// Core types for browser operations
export interface ScreenshotOptions {
  fullPage?: boolean;
  clip?: { x: number; y: number; width: number; height: number };
  quality?: number;
  type?: 'png' | 'jpeg';
}

export interface NavigationOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
}

export interface ScrapeOptions {
  selector?: string;
  waitForSelector?: string;
  extractText?: boolean;
  extractHtml?: boolean;
  extractLinks?: boolean;
  extractImages?: boolean;
  followPagination?: boolean;
  maxPages?: number;
}

/**
 * BrowserTools - Consolidated browser automation with MCP integration
 * 
 * This class combines:
 * 1. Core browser automation (BrowserTools functionality)
 * 2. MCP protocol integration (BrowserMcpTools functionality)
 * 3. Intelligent session management
 * 4. Consolidated tool interface
 */
export class BrowserTools {
  // Core browser automation state
  private sessions = new Map<string, BrowserSession>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  // MCP integration state
  private sessionMetadata = new Map<string, SessionMetadata>();
  private sessionCleanupInterval: NodeJS.Timeout | null = null;
  private memoryService: MemoryService;

  constructor(
    private knowledgeGraphService: KnowledgeGraphService,
    private repositoryPath: string,
    private db: any
  ) {
    this.memoryService = new MemoryService(db);
    this.startCleanupServices();
  }

  /**
   * Get optimized browser-related MCP tools (Phase 4)
   * Consolidated from 8 tools to 5 essential tools with smart session management
   */
  getTools() {
    return [
      {
        name: 'create_browser_session',
        description: 'Create a new browser session with intelligent auto-close and session management',
        inputSchema: BrowserCreateSessionSchema,
        outputSchema: BrowserOperationResponseSchema
      },
      {
        name: 'navigate_and_scrape',
        description: 'Navigate to a URL and optionally scrape content in one operation. Auto-creates session if needed.',
        inputSchema: BrowserNavigateAndScrapeSchema,
        outputSchema: BrowserOperationResponseSchema
      },
      {
        name: 'interact_with_page',
        description: 'Perform multiple interactions with a page: click, type, hover, select, screenshot, wait, scroll',
        inputSchema: BrowserInteractWithPageSchema,
        outputSchema: BrowserOperationResponseSchema
      },
      {
        name: 'manage_browser_sessions',
        description: 'Manage browser sessions: list, close, cleanup idle sessions, get status',
        inputSchema: BrowserManageSessionsSchema,
        outputSchema: BrowserOperationResponseSchema
      },
      // Legacy tools for backward compatibility
      {
        name: 'navigate_to_url',
        description: '[LEGACY] Navigate to a URL in an existing browser session. Use navigate_and_scrape instead.',
        inputSchema: BrowserLegacyNavigateSchema,
        outputSchema: BrowserOperationResponseSchema
      }
    ];
  }

  /**
   * Handle MCP tool calls for browser functionality with intelligent session management
   */
  async handleToolCall(name: string, arguments_: any): Promise<BrowserOperationResponse> {
    const startTime = performance.now();
    
    try {
      let result: any;
      
      switch (name) {
        case 'create_browser_session':
          result = await this.createBrowserSessionEnhanced(arguments_);
          break;
        
        case 'navigate_and_scrape':
          result = await this.navigateAndScrape(arguments_);
          break;
        
        case 'interact_with_page':
          result = await this.interactWithPage(arguments_);
          break;
        
        case 'manage_browser_sessions':
          result = await this.manageBrowserSessions(arguments_);
          break;
        
        // Legacy support
        case 'navigate_to_url':
          result = await this.navigateToUrl(arguments_);
          break;
        
        case 'scrape_content':
          result = await this.scrapeContent(arguments_);
          break;
        
        case 'take_screenshot':
          result = await this.takeScreenshot(arguments_);
          break;
        
        case 'execute_browser_script':
          result = await this.executeScript(arguments_);
          break;
        
        case 'interact_with_element':
          result = await this.interactWithElement(arguments_);
          break;
        
        case 'close_browser_session':
          result = await this.closeBrowserSession(arguments_);
          break;
        
        case 'list_browser_sessions':
          result = await this.listBrowserSessions();
          break;
        
        default:
          throw new Error(`Unknown browser tool: ${name}`);
      }
      
      const executionTime = performance.now() - startTime;
      
      // Transform result to standardized format
      if (result && typeof result === 'object' && 'success' in result) {
        return createSuccessResponse(
          result.message || `${name} completed successfully`,
          this.transformResultData(result, name),
          executionTime
        ) as BrowserOperationResponse;
      } else {
        return createSuccessResponse(
          `${name} completed successfully`,
          this.transformResultData(result, name),
          executionTime
        ) as BrowserOperationResponse;
      }
    } catch (error) {
      const executionTime = performance.now() - startTime;
      return createErrorResponse(
        `${name} failed to execute`,
        error instanceof Error ? error.message : 'Unknown error occurred',
        'BROWSER_TOOL_ERROR'
      ) as BrowserOperationResponse;
    }
  }

  // ===================================
  // Core Browser Automation Methods
  // ===================================

  /**
   * Create a new browser session with specified browser type
   */
  private async createBrowserSessionCore(
    browserType: 'chromium' | 'firefox' | 'webkit' = 'chromium',
    options: {
      headless?: boolean;
      viewport?: { width: number; height: number };
      userAgent?: string;
      agentId?: string;
    } = {}
  ): Promise<{ success: boolean; sessionId: string; error?: string }> {
    try {
      const sessionId = `browser_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      
      // Generate realistic user agent if not provided
      let userAgent = options.userAgent;
      if (!userAgent) {
        const deviceCategory = Math.random() > 0.7 ? 'mobile' : 'desktop';
        
        try {
          // Try to use user-agents package first
          let attempts = 0;
          let generatedAgent: any;
          do {
            generatedAgent = new UserAgent({
              deviceCategory,
              platform: deviceCategory === 'mobile' ? 'mobile' : 'desktop'
            });
            attempts++;
          } while (attempts < 10 && !generatedAgent.toString().includes('Chrome'));
          
          userAgent = generatedAgent.toString();
          process.stderr.write(`Generated user agent via user-agents package for session ${sessionId}: ${userAgent}\n`);
        } catch (error) {
          // Fallback to our custom generator if user-agents package fails
          userAgent = UserAgentGenerator.generateChromeUserAgent(deviceCategory);
          process.stderr.write(`Generated user agent via fallback for session ${sessionId}: ${userAgent}\n`);
        }
      }
      
      // Launch browser
      let browser: Browser;
      switch (browserType) {
        case 'firefox':
          browser = await firefox.launch({
            headless: options.headless ?? true,
            args: ['--disable-blink-features=AutomationControlled']
          });
          break;
        case 'webkit':
          browser = await webkit.launch({
            headless: options.headless ?? true
          });
          break;
        default:
          browser = await chromium.launch({
            headless: options.headless ?? true,
            args: [
              '--disable-blink-features=AutomationControlled',
              '--disable-features=VizDisplayCompositor',
              '--no-sandbox',
              '--disable-dev-shm-usage'
            ]
          });
      }

      // Create context with realistic user agent
      const context = await browser.newContext({
        viewport: options.viewport || { width: 1920, height: 1080 },
        userAgent,
        // Stealth settings to avoid detection
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      // Create page
      const page = await context.newPage();
      
      // Add stealth JavaScript
      await page.addInitScript(() => {
        // Remove webdriver property
        Object.defineProperty((globalThis as any).navigator, 'webdriver', {
          get: () => undefined,
        });
        
        // Mock plugins and languages
        Object.defineProperty((globalThis as any).navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });
        
        Object.defineProperty((globalThis as any).navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });
      });

      const session: BrowserSession = {
        id: sessionId,
        browser,
        context,
        page,
        browserType,
        createdAt: new Date(),
        lastUsed: new Date(),
        repositoryPath: this.repositoryPath,
        agentId: options.agentId
      };

      this.sessions.set(sessionId, session);

      // Store in knowledge graph for other agents
      try {
        await this.knowledgeGraphService.createEntity({
          id: `browser-session-${Date.now()}`,
          repositoryPath: this.repositoryPath,
          entityType: 'task',
          name: `Browser session created: ${sessionId}`,
          description: `Created ${browserType} browser session with ID ${sessionId}`,
          properties: { sessionId, browserType },
          discoveredBy: options.agentId || 'system',
          discoveredDuring: 'browser-session-creation',
          importanceScore: 0.3,
          confidenceScore: 1.0,
          relevanceScore: 0.5
        });
      } catch (error) {
        console.warn('Failed to store browser session in knowledge graph:', error);
      }

      return { success: true, sessionId };
    } catch (error) {
      return { 
        success: false, 
        sessionId: '', 
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Navigate to a URL in the specified session
   */
  private async navigateToUrlCore(
    sessionId: string,
    url: string,
    options: NavigationOptions = {}
  ): Promise<{ success: boolean; title?: string; url?: string; error?: string }> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return { success: false, error: `Session ${sessionId} not found` };
      }

      session.lastUsed = new Date();
      this.updateSessionActivity(sessionId);

      const response = await session.page.goto(url, {
        waitUntil: options.waitUntil || 'domcontentloaded',
        timeout: options.timeout || 30000
      });

      if (!response || !response.ok()) {
        return { success: false, error: `Failed to load ${url}: ${response?.status()}` };
      }

      const title = await session.page.title();
      const finalUrl = session.page.url();

      return { success: true, title, url: finalUrl };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Navigation failed'
      };
    }
  }

  /**
   * Take a screenshot of the current page
   */
  private async takeScreenshotCore(
    sessionId: string,
    filepath: string,
    options: ScreenshotOptions = {}
  ): Promise<{ success: boolean; filepath?: string; error?: string }> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return { success: false, error: `Session ${sessionId} not found` };
      }

      session.lastUsed = new Date();
      this.updateSessionActivity(sessionId);

      await session.page.screenshot({
        path: filepath,
        fullPage: options.fullPage ?? false,
        clip: options.clip,
        quality: options.quality,
        type: options.type || 'png'
      });

      return { success: true, filepath };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Screenshot failed'
      };
    }
  }

  /**
   * Scrape content from the current page
   */
  private async scrapeContentCore(
    sessionId: string,
    options: ScrapeOptions = {}
  ): Promise<{ 
    success: boolean; 
    content?: {
      text?: string;
      html?: string;
      links?: Array<{ text: string; href: string }>;
      images?: Array<{ alt: string; src: string }>;
    };
    error?: string;
  }> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return { success: false, error: `Session ${sessionId} not found` };
      }

      session.lastUsed = new Date();
      this.updateSessionActivity(sessionId);

      // Wait for selector if specified
      if (options.waitForSelector) {
        await session.page.waitForSelector(options.waitForSelector, { timeout: 10000 });
      }

      const content: any = {};

      // Extract text content
      if (options.extractText !== false) {
        if (options.selector) {
          const element = await session.page.$(options.selector);
          content.text = element ? await element.textContent() : null;
        } else {
          content.text = await session.page.textContent('body');
        }
      }

      // Extract HTML content
      if (options.extractHtml) {
        if (options.selector) {
          const element = await session.page.$(options.selector);
          content.html = element ? await element.innerHTML() : null;
        } else {
          content.html = await session.page.content();
        }
      }

      // Extract links
      if (options.extractLinks) {
        content.links = await session.page.evaluate(() => {
          const links = Array.from((globalThis as any).document.querySelectorAll('a[href]'));
          return links.map((link: any) => ({
            text: link.textContent?.trim() || '',
            href: link.href
          }));
        });
      }

      // Extract images
      if (options.extractImages) {
        content.images = await session.page.evaluate(() => {
          const images = Array.from((globalThis as any).document.querySelectorAll('img'));
          return images.map((img: any) => ({
            alt: img.alt || '',
            src: img.src
          }));
        });
      }

      return { success: true, content };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Scraping failed'
      };
    }
  }

  /**
   * Execute JavaScript in the browser context
   */
  private async executeScriptCore(
    sessionId: string,
    script: string,
    args: any[] = []
  ): Promise<{ success: boolean; result?: any; error?: string }> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return { success: false, error: `Session ${sessionId} not found` };
      }

      session.lastUsed = new Date();
      this.updateSessionActivity(sessionId);

      const result = await session.page.evaluate(({ script, args }) => {
        const func = new Function('...args', script);
        return func(...args);
      }, { script, args });

      return { success: true, result };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Script execution failed'
      };
    }
  }

  /**
   * Interact with page elements (click, type, etc.)
   */
  private async interactWithElementCore(
    sessionId: string,
    action: 'click' | 'type' | 'hover' | 'select',
    selector: string,
    value?: string | string[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return { success: false, error: `Session ${sessionId} not found` };
      }

      session.lastUsed = new Date();
      this.updateSessionActivity(sessionId);

      // Wait for element to be available
      await session.page.waitForSelector(selector, { timeout: 10000 });

      switch (action) {
        case 'click':
          await session.page.click(selector);
          break;
        case 'type':
          if (typeof value === 'string') {
            await session.page.fill(selector, value);
          }
          break;
        case 'hover':
          await session.page.hover(selector);
          break;
        case 'select':
          if (Array.isArray(value)) {
            await session.page.selectOption(selector, value);
          }
          break;
      }

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Element interaction failed'
      };
    }
  }

  /**
   * Close a browser session
   */
  private async closeBrowserSessionCore(sessionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return { success: false, error: `Session ${sessionId} not found` };
      }

      await session.context.close();
      await session.browser.close();
      this.sessions.delete(sessionId);

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to close session'
      };
    }
  }

  /**
   * List all active browser sessions
   */
  private async listSessionsCore(): Promise<Array<{
    id: string;
    browserType: string;
    createdAt: Date;
    lastUsed: Date;
    agentId?: string;
  }>> {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      browserType: session.browserType,
      createdAt: session.createdAt,
      lastUsed: session.lastUsed,
      agentId: session.agentId
    }));
  }

  // ===================================
  // MCP Enhanced Methods
  // ===================================

  private async createBrowserSessionEnhanced(args: any) {
    const params = BrowserCreateSessionSchema.parse(args);
    
    const result = await this.createBrowserSessionCore(
      params.browser_type,
      {
        headless: params.headless,
        viewport: { width: params.viewport_width, height: params.viewport_height },
        userAgent: params.user_agent,
        agentId: params.agent_id
      }
    );

    if (result.success) {
      // Store session metadata for intelligent management
      this.sessionMetadata.set(result.sessionId, {
        sessionId: result.sessionId,
        workflowType: params.workflow_type,
        autoClose: params.auto_close,
        createdAt: new Date(),
        lastActivity: new Date(),
        taskCompleted: false
      });

      // Store in memory for other agents
      if (params.agent_id) {
        await this.memoryService.storeInsight(
          this.repositoryPath,
          params.agent_id,
          'Browser session created',
          `Created ${params.browser_type} session ${result.sessionId} for ${params.workflow_type} workflow (auto-close: ${params.auto_close})`,
          ['browser', 'session', 'created', params.workflow_type, params.browser_type]
        );
      }

      // Set up auto-close timer for non-documentation workflows
      if (params.auto_close && params.workflow_type !== 'documentation') {
        setTimeout(() => {
          this.autoCloseSession(result.sessionId);
        }, params.session_timeout);
      }
    }

    return {
      ...result,
      sessionConfig: {
        workflowType: params.workflow_type,
        autoClose: params.auto_close,
        sessionTimeout: params.session_timeout,
        maxIdleTime: params.max_idle_time
      }
    };
  }

  private async navigateAndScrape(args: any) {
    const params = BrowserNavigateAndScrapeSchema.parse(args);
    
    let sessionId = params.session_id;
    let sessionCreated = false;

    // Auto-create session if needed
    if (!sessionId && params.auto_create_session) {
      const createResult = await this.createBrowserSessionEnhanced({
        browser_type: params.browser_type,
        workflow_type: 'automation',
        auto_close: true
      });
      
      if (!createResult.success) {
        return createResult;
      }
      
      sessionId = createResult.sessionId;
      sessionCreated = true;
    }

    if (!sessionId) {
      return { success: false, error: 'No session ID provided and auto-create disabled' };
    }

    // Update session activity
    this.updateSessionActivity(sessionId);

    // Navigate to URL
    const navResult = await this.navigateToUrlCore(
      sessionId,
      params.url,
      {
        waitUntil: params.wait_until,
        timeout: params.timeout
      }
    );

    if (!navResult.success) {
      // Clean up auto-created session on failure
      if (sessionCreated) {
        await this.closeBrowserSessionCore(sessionId);
        this.sessionMetadata.delete(sessionId);
      }
      return navResult;
    }

    // Scrape content if any extraction options are enabled
    let scrapeResult = null;
    if (params.extract_text || params.extract_html || params.extract_links || params.extract_images) {
      scrapeResult = await this.scrapeContentCore(
        sessionId,
        {
          selector: params.selector,
          waitForSelector: params.wait_for_selector,
          extractText: params.extract_text,
          extractHtml: params.extract_html,
          extractLinks: params.extract_links,
          extractImages: params.extract_images
        }
      );
    }

    // Auto-close session if it was created for this operation
    if (sessionCreated) {
      setTimeout(() => {
        this.autoCloseSession(sessionId!);
      }, 5000); // 5 second delay to allow for immediate follow-up operations
    }

    return {
      success: true,
      sessionId,
      sessionCreated,
      navigation: navResult,
      content: scrapeResult?.content || null,
      url: navResult.url,
      title: navResult.title
    };
  }

  private async interactWithPage(args: any) {
    const params = BrowserInteractWithPageSchema.parse(args);
    
    this.updateSessionActivity(params.session_id);
    
    const results = [];
    
    for (const action of params.actions) {
      let result;
      
      switch (action.type) {
        case 'click':
        case 'type':
        case 'hover':
        case 'select':
          result = await this.interactWithElementCore(
            params.session_id,
            action.type,
            action.selector!,
            action.value
          );
          break;
          
        case 'screenshot':
          result = await this.takeScreenshotCore(
            params.session_id,
            action.filepath!,
            {
              fullPage: true,
              type: 'png'
            }
          );
          break;
          
        case 'wait':
          if (action.selector) {
            // Wait for selector
            result = await this.waitForSelector(params.session_id, action.selector, action.timeout || 10000);
          } else {
            // Wait for time
            await new Promise(resolve => setTimeout(resolve, action.timeout || 1000));
            result = { success: true, action: 'wait', duration: action.timeout || 1000 };
          }
          break;
          
        case 'scroll':
          result = await this.scrollPage(params.session_id, action.selector, action.scroll_behavior || 'auto');
          break;
          
        default:
          result = { success: false, error: `Unknown action type: ${action.type}` };
      }
      
      results.push({
        action: action.type,
        selector: action.selector,
        result
      });
      
      // Stop on first failure
      if (!result.success) {
        break;
      }
    }
    
    // Auto-close session if requested
    if (params.auto_close_after) {
      setTimeout(() => {
        this.autoCloseSession(params.session_id);
      }, 2000); // 2 second delay
    }
    
    return {
      success: results.every(r => r.result.success),
      results,
      totalActions: params.actions.length,
      completedActions: results.length
    };
  }

  private async manageBrowserSessions(args: any) {
    const params = BrowserManageSessionsSchema.parse(args);
    
    switch (params.action) {
      case 'list':
        return await this.listBrowserSessionsEnhanced();
        
      case 'close':
        if (!params.session_id) {
          return { success: false, error: 'session_id required for close action' };
        }
        return await this.closeBrowserSessionEnhanced(params.session_id, params.force_close);
        
      case 'close_all':
        return await this.closeAllSessions(params.force_close);
        
      case 'cleanup_idle':
        return await this.cleanupIdleSessions(params.cleanup_criteria);
        
      case 'get_status':
        return await this.getSessionsStatus();
        
      default:
        return { success: false, error: `Unknown action: ${params.action}` };
    }
  }

  // Enhanced session management methods
  private async listBrowserSessionsEnhanced() {
    const sessions = await this.listSessionsCore();
    
    return {
      success: true,
      sessions: sessions.map(session => {
        const metadata = this.sessionMetadata.get(session.id);
        return {
          ...session,
          workflowType: metadata?.workflowType || 'unknown',
          autoClose: metadata?.autoClose || false,
          lastActivity: metadata?.lastActivity || session.lastUsed,
          taskCompleted: metadata?.taskCompleted || false
        };
      })
    };
  }

  private async closeBrowserSessionEnhanced(sessionId: string, forceClose: boolean = false) {
    const metadata = this.sessionMetadata.get(sessionId);
    
    // Don't close documentation sessions unless forced
    if (!forceClose && metadata?.workflowType === 'documentation') {
      return {
        success: false,
        error: 'Cannot close documentation session without force_close=true'
      };
    }
    
    const result = await this.closeBrowserSessionCore(sessionId);
    
    if (result.success) {
      this.sessionMetadata.delete(sessionId);
    }
    
    return result;
  }

  private async closeAllSessions(forceClose: boolean = false) {
    const sessions = await this.listSessionsCore();
    const results = [];
    
    for (const session of sessions) {
      const result = await this.closeBrowserSessionEnhanced(session.id, forceClose);
      results.push({
        sessionId: session.id,
        result
      });
    }
    
    return {
      success: true,
      results,
      totalSessions: sessions.length,
      closedSessions: results.filter(r => r.result.success).length
    };
  }

  private async cleanupIdleSessions(criteria: any = {}) {
    const sessions = await this.listSessionsCore();
    const now = new Date();
    const maxIdleMs = (criteria.max_idle_minutes || 10) * 60 * 1000;
    const excludeDocumentation = criteria.exclude_documentation !== false;
    
    const idleSessions = sessions.filter(session => {
      const metadata = this.sessionMetadata.get(session.id);
      const lastActivity = metadata?.lastActivity || session.lastUsed;
      const isIdle = (now.getTime() - lastActivity.getTime()) > maxIdleMs;
      
      // Skip documentation sessions if excluded
      if (excludeDocumentation && metadata?.workflowType === 'documentation') {
        return false;
      }
      
      return isIdle;
    });
    
    const results = [];
    for (const session of idleSessions) {
      const result = await this.closeBrowserSessionCore(session.id);
      this.sessionMetadata.delete(session.id);
      results.push({
        sessionId: session.id,
        result
      });
    }
    
    return {
      success: true,
      cleanedSessions: results.length,
      criteria,
      results
    };
  }
  
  private async getSessionsStatus() {
    const sessions = await this.listSessionsCore();
    const now = new Date();
    
    const status = {
      totalSessions: sessions.length,
      byWorkflowType: {} as Record<string, number>,
      byStatus: {
        active: 0,
        idle: 0,
        stale: 0
      },
      autoCloseEnabled: 0,
      documentationSessions: 0
    };
    
    sessions.forEach(session => {
      const metadata = this.sessionMetadata.get(session.id);
      const workflowType = metadata?.workflowType || 'unknown';
      const lastActivity = metadata?.lastActivity || session.lastUsed;
      const idleTime = now.getTime() - lastActivity.getTime();
      
      // Count by workflow type
      status.byWorkflowType[workflowType] = (status.byWorkflowType[workflowType] || 0) + 1;
      
      // Count by status
      if (idleTime < 5 * 60 * 1000) { // 5 minutes
        status.byStatus.active++;
      } else if (idleTime < 30 * 60 * 1000) { // 30 minutes
        status.byStatus.idle++;
      } else {
        status.byStatus.stale++;
      }
      
      // Count special types
      if (metadata?.autoClose) {
        status.autoCloseEnabled++;
      }
      if (workflowType === 'documentation') {
        status.documentationSessions++;
      }
    });
    
    return {
      success: true,
      status,
      sessions: sessions.map(session => {
        const metadata = this.sessionMetadata.get(session.id);
        return {
          ...session,
          workflowType: metadata?.workflowType || 'unknown',
          autoClose: metadata?.autoClose || false,
          lastActivity: metadata?.lastActivity || session.lastUsed,
          idleTimeMinutes: Math.floor((now.getTime() - (metadata?.lastActivity || session.lastUsed).getTime()) / (60 * 1000))
        };
      })
    };
  }

  // Session management utility methods
  private updateSessionActivity(sessionId: string) {
    const metadata = this.sessionMetadata.get(sessionId);
    if (metadata) {
      metadata.lastActivity = new Date();
    }
  }
  
  private async autoCloseSession(sessionId: string) {
    const metadata = this.sessionMetadata.get(sessionId);
    
    // Don't auto-close documentation sessions
    if (metadata?.workflowType === 'documentation') {
      return;
    }
    
    // Don't auto-close if disabled
    if (!metadata?.autoClose) {
      return;
    }
    
    await this.closeBrowserSessionCore(sessionId);
    this.sessionMetadata.delete(sessionId);
  }
  
  private async waitForSelector(sessionId: string, selector: string, timeout: number = 10000) {
    try {
      const sessions = await this.listSessionsCore();
      const sessionExists = sessions.some(s => s.id === sessionId);
      
      if (!sessionExists) {
        return { success: false, error: `Session ${sessionId} not found` };
      }
      
      const session = this.sessions.get(sessionId);
      if (!session) {
        return { success: false, error: `Session ${sessionId} not found` };
      }
      
      await session.page.waitForSelector(selector, { timeout });
      
      return { success: true, selector, timeout };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Wait failed'
      };
    }
  }
  
  private async scrollPage(sessionId: string, selector?: string, behavior: 'auto' | 'smooth' = 'auto') {
    try {
      const script = selector 
        ? `document.querySelector('${selector}')?.scrollIntoView({ behavior: '${behavior}' })`
        : `window.scrollTo({ top: document.body.scrollHeight, behavior: '${behavior}' })`;
      
      const result = await this.executeScriptCore(sessionId, script);
      
      return {
        success: true,
        action: 'scroll',
        selector,
        behavior,
        scriptResult: result
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Scroll failed'
      };
    }
  }
  
  private startCleanupServices() {
    // Original cleanup service from BrowserTools
    this.cleanupInterval = setInterval(() => {
      const now = new Date();
      const maxAge = 30 * 60 * 1000; // 30 minutes

      for (const [sessionId, session] of this.sessions.entries()) {
        if (now.getTime() - session.lastUsed.getTime() > maxAge) {
          this.closeBrowserSessionCore(sessionId).catch(console.error);
        }
      }
    }, 5 * 60 * 1000); // Check every 5 minutes

    // Enhanced cleanup service from BrowserMcpTools
    this.sessionCleanupInterval = setInterval(async () => {
      try {
        await this.cleanupIdleSessions({
          max_idle_minutes: 15,
          exclude_documentation: true
        });
      } catch (error) {
        console.error('Session cleanup error:', error);
      }
    }, 5 * 60 * 1000);
  }
  
  /**
   * Transform result data to match BrowserOperationResponse schema
   */
  private transformResultData(result: any, toolName: string): any {
    if (!result || typeof result !== 'object') {
      return { script_result: result };
    }
    
    const data: any = {};
    
    // Map common fields
    if (result.sessionId) data.session_id = result.sessionId;
    if (result.url) data.url = result.url;
    if (result.content) data.content = result.content;
    if (result.html) data.html = result.html;
    if (result.sessions) data.sessions = result.sessions;
    if (result.results) data.interactions = result.results;
    if (result.screenshot_path || result.filepath) {
      data.screenshot_path = result.screenshot_path || result.filepath;
    }
    
    // Handle navigation results
    if (result.navigation) {
      data.url = result.navigation.url;
      data.metadata = {
        title: result.navigation.title,
        navigation_success: result.navigation.success
      };
    }
    
    // Handle script execution results
    if (result.scriptResult !== undefined) {
      data.script_result = result.scriptResult;
    }
    
    // Handle session management results
    if (toolName === 'manage_browser_sessions') {
      if (result.status) data.metadata = result.status;
      if (result.cleanedSessions !== undefined) {
        data.metadata = { ...data.metadata, cleaned_sessions: result.cleanedSessions };
      }
    }
    
    // Include any additional data that doesn't match standard fields
    const standardFields = ['sessionId', 'url', 'content', 'html', 'sessions', 'results', 'screenshot_path', 'filepath', 'navigation', 'scriptResult', 'status', 'cleanedSessions'];
    Object.keys(result).forEach(key => {
      if (!standardFields.includes(key) && !data.hasOwnProperty(key)) {
        if (!data.metadata) data.metadata = {};
        data.metadata[key] = result[key];
      }
    });
    
    return data;
  }
  
  async shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
      this.sessionCleanupInterval = null;
    }
    
    // Close all sessions
    await this.closeAllSessions(true);
  }
  
  // Legacy method implementations for backward compatibility
  private async navigateToUrl(args: any) {
    const params = BrowserLegacyNavigateSchema.parse(args);
    
    this.updateSessionActivity(params.session_id);
    
    const result = await this.navigateToUrlCore(
      params.session_id,
      params.url,
      {
        waitUntil: params.wait_until,
        timeout: params.timeout
      }
    );

    return result;
  }
  
  private async scrapeContent(args: any) {
    const params = BrowserLegacyScrapeSchema.parse(args);
    
    this.updateSessionActivity(params.session_id);
    
    const result = await this.scrapeContentCore(
      params.session_id,
      {
        selector: params.selector,
        waitForSelector: params.wait_for_selector,
        extractText: params.extract_text,
        extractHtml: params.extract_html,
        extractLinks: params.extract_links,
        extractImages: params.extract_images
      }
    );

    return result;
  }
  
  private async takeScreenshot(args: any) {
    const params = BrowserScreenshotSchema.parse(args);
    
    this.updateSessionActivity(params.session_id);
    
    const result = await this.takeScreenshotCore(
      params.session_id,
      params.filepath,
      {
        fullPage: params.full_page,
        quality: params.quality,
        type: params.type
      }
    );

    return result;
  }
  
  private async executeScript(args: any) {
    const params = BrowserExecuteScriptSchema.parse(args);
    
    this.updateSessionActivity(params.session_id);
    
    const result = await this.executeScriptCore(
      params.session_id,
      params.script,
      params.args
    );

    return result;
  }
  
  private async interactWithElement(args: any) {
    const params = BrowserInteractSchema.parse(args);
    
    this.updateSessionActivity(params.session_id);
    
    const result = await this.interactWithElementCore(
      params.session_id,
      params.action,
      params.selector,
      params.value
    );

    return result;
  }
  
  private async closeBrowserSession(args: any) {
    const { session_id } = z.object({ session_id: z.string() }).parse(args);
    
    return await this.closeBrowserSessionEnhanced(session_id, false);
  }
  
  private async listBrowserSessions() {
    const result = await this.listBrowserSessionsEnhanced();
    return result;
  }
}

// Export schemas for MCP server registration
export {
  SessionConfigSchema,
  SessionMetadataSchema
};