/**
 * Browser automation tools using Patchright (Playwright with patches)
 * Provides web scraping, automation, and interaction capabilities for agents
 */

import { chromium, firefox, webkit } from 'patchright';
import type { Browser, Page, BrowserContext } from 'patchright';
import UserAgent from 'user-agents';
import type { ClaudeDatabase } from '../database/index.js';
import type { MemoryService } from '../services/MemoryService.js';

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

export interface ScreenshotOptions {
  fullPage?: boolean;
  clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
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

export class BrowserTools {
  private sessions = new Map<string, BrowserSession>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    private memoryService: MemoryService,
    private repositoryPath: string
  ) {
    this.startCleanupService();
  }

  /**
   * Create a new browser session with specified browser type
   */
  async createBrowserSession(
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
          console.log(`Generated user agent via user-agents package for session ${sessionId}: ${userAgent}`);
        } catch (error) {
          // Fallback to our custom generator if user-agents package fails
          userAgent = UserAgentGenerator.generateChromeUserAgent(deviceCategory);
          console.log(`Generated user agent via fallback for session ${sessionId}: ${userAgent}`);
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

      // Store in memory for other agents
      await this.memoryService.storeMemory(
        this.repositoryPath,
        options.agentId || 'system',
        'shared',
        `Browser session created: ${sessionId}`,
        `Created ${browserType} browser session with ID ${sessionId}`
      );

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
  async navigateToUrl(
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
  async takeScreenshot(
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
  async scrapeContent(
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
  async executeScript(
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
  async interactWithElement(
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
  async closeBrowserSession(sessionId: string): Promise<{ success: boolean; error?: string }> {
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
  async listSessions(): Promise<Array<{
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

  /**
   * Start cleanup service to remove inactive sessions
   */
  private startCleanupService(): void {
    this.cleanupInterval = setInterval(() => {
      const now = new Date();
      const maxAge = 30 * 60 * 1000; // 30 minutes

      for (const [sessionId, session] of this.sessions.entries()) {
        if (now.getTime() - session.lastUsed.getTime() > maxAge) {
          this.closeBrowserSession(sessionId).catch(console.error);
        }
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  /**
   * Stop cleanup service and close all sessions
   */
  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Close all active sessions
    const closePromises = Array.from(this.sessions.keys()).map(sessionId =>
      this.closeBrowserSession(sessionId)
    );

    await Promise.allSettled(closePromises);
  }
}