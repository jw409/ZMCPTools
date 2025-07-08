/**
 * Simple browser manager using Patchright (TypeScript port of Python implementation)
 */

import { randomInt } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'patchright';
import { Logger } from '../utils/logger.js';
import { PatternMatcher } from '../utils/patternMatcher.js';
import { SitemapParser, type SitemapResult } from '../utils/sitemapParser.js';

export interface BrowserManagerConfig {
  browserType: 'chrome';
  headless: boolean;
  userDataDir?: string;
  retryCount: number;
  retryDelay: number;
}

export interface NavigationOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
}

export interface InteractionOptions {
  delay?: number;
  force?: boolean;
  timeout?: number;
}

export interface ExtractionOptions {
  timeout?: number;
  clean?: boolean;
  onlyVisible?: boolean;
}

export interface PageContentResult {
  title: string;
  content: string;
  links: string[];
  codeExamples: string[];
  url: string;
  sitemapData?: SitemapResult;
}

export class BrowserManager {
  private browserType: 'chrome';
  private headless: boolean;
  private browserContext: BrowserContext | null = null;
  private retryCount: number;
  private retryDelay: number;
  private logger: Logger;
  private userDataDir: string;

  constructor(config: BrowserManagerConfig) {
    this.browserType = config.browserType;
    this.headless = config.headless;
    this.retryCount = config.retryCount;
    this.retryDelay = config.retryDelay;
    this.logger = new Logger('browser-manager');
    
    // Set up user data directory
    this.userDataDir = config.userDataDir || this.createDefaultUserDataDir();
  }

  private createDefaultUserDataDir(): string {
    const browserDataRoot = join(homedir(), '.mcptools', 'browser_data');
    if (!existsSync(browserDataRoot)) {
      mkdirSync(browserDataRoot, { recursive: true });
    }
    
    const persistentDir = join(browserDataRoot, `${this.browserType}_${randomInt(1000, 9999)}`);
    if (!existsSync(persistentDir)) {
      mkdirSync(persistentDir, { recursive: true });
    }
    
    return persistentDir;
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing patchright browser', { browserType: this.browserType });

    try {
      // Clean up any stale lock files
      this.cleanupLockFiles();

      // Browser launch options
      const launchOptions = {
        headless: this.headless,
        args: [
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-features=VizDisplayCompositor',
          '--disable-background-timer-throttling',
          '--disable-extensions',
          '--disable-plugins',
          '--disable-sync',
          '--disable-translate',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-notifications',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-software-rasterizer',
          '--remote-debugging-port=9222',
        ],
      };

      this.browserContext = await chromium.launchPersistentContext(
        this.userDataDir,
        launchOptions
      );

      // Set up context handlers
      this.setupContextHandlers();
      
      this.logger.info('Browser initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize browser', { error });
      throw error;
    }
  }

  private cleanupLockFiles(): void {
    const lockFiles = ['SingletonLock', 'lockfile', 'chrome.lock'];
    for (const lockFile of lockFiles) {
      const lockPath = join(this.userDataDir, lockFile);
      if (existsSync(lockPath)) {
        try {
          unlinkSync(lockPath);
          this.logger.info(`Cleaned up stale lock file: ${lockPath}`);
        } catch (error) {
          this.logger.warn(`Failed to clean lock file ${lockPath}`, { error });
        }
      }
    }
  }

  private setupContextHandlers(): void {
    if (!this.browserContext) return;

    // Set up page event handlers
    this.browserContext.on('page', (page) => {
      this.setupPageHandlers(page);
    });
  }

  private setupPageHandlers(page: Page): void {
    page.on('dialog', (dialog) => dialog.dismiss());
    page.on('pageerror', (error) => {
      this.logger.error('Page error', { error: error.message });
    });
    page.on('crash', () => {
      this.logger.error('Page crashed', { url: page.url() });
    });
  }

  async newPage(): Promise<Page> {
    if (!this.browserContext) {
      await this.initialize();
    }
    if (!this.browserContext) {
      throw new Error('Browser context is not initialized');
    }
    return this.browserContext.newPage();
  }

  async navigateToUrl(page: Page, url: string, options: NavigationOptions = {}): Promise<boolean> {
    const { waitUntil = 'domcontentloaded', timeout = 30000 } = options;

    // Check if already on the correct page
    try {
      const currentUrl = page.url();
      if (currentUrl === url) {
        this.logger.info('Already on target URL', { url });
        return true;
      }
    } catch (error) {
      // If we can't get current URL, proceed with navigation
    }

    for (let attempt = 0; attempt < this.retryCount; attempt++) {
      try {
        this.logger.info('Navigating to URL', { url, attempt: attempt + 1 });

        await page.goto(url, { waitUntil, timeout });
        await page.waitForLoadState('networkidle', { timeout: 10000 });

        const finalUrl = page.url();
        if (finalUrl !== url && !finalUrl.startsWith(url)) {
          this.logger.warn('URL mismatch after navigation', { 
            expected: url, 
            actual: finalUrl 
          });
        }

        this.logger.info('Successfully navigated', { url, finalUrl });
        return true;
      } catch (error) {
        this.logger.warn('Navigation attempt failed', { 
          url, 
          attempt: attempt + 1, 
          error: error instanceof Error ? error.message : String(error) 
        });
        
        if (attempt < this.retryCount - 1) {
          await this.sleep(this.retryDelay * (attempt + 1));
        } else {
          this.logger.error('All navigation attempts failed', { url });
          return false;
        }
      }
    }
    return false;
  }

  async clickElement(page: Page, selector: string, options: InteractionOptions = {}): Promise<boolean> {
    const { delay = randomInt(50, 150), force = false, timeout = 10000 } = options;

    try {
      await page.waitForSelector(selector, { state: 'visible', timeout });
      await page.locator(selector).scrollIntoViewIfNeeded();
      
      // Human-like delay
      await this.sleep(randomInt(100, 300));
      
      await page.locator(selector).click({ force });
      await page.waitForLoadState('networkidle', { timeout: 5000 });

      this.logger.info('Clicked element', { selector });
      return true;
    } catch (error) {
      this.logger.error('Failed to click element', { 
        selector, 
        error: error instanceof Error ? error.message : String(error) 
      });
      return false;
    }
  }

  async fillInput(page: Page, selector: string, text: string, options: InteractionOptions = {}): Promise<boolean> {
    const { delay = randomInt(10, 75), timeout = 10000 } = options;

    try {
      await page.waitForSelector(selector, { state: 'visible', timeout });
      await page.locator(selector).clear();
      await page.locator(selector).pressSequentially(text, { delay });

      this.logger.info('Filled input', { selector, text });
      return true;
    } catch (error) {
      this.logger.error('Failed to fill input', { 
        selector, 
        error: error instanceof Error ? error.message : String(error) 
      });
      return false;
    }
  }

  async extractText(page: Page, selector: string, options: ExtractionOptions = {}): Promise<string | null> {
    const { timeout = 5000, clean = true } = options;

    try {
      await page.waitForSelector(selector, { timeout });
      const element = page.locator(selector).first();
      
      if (!await element.isVisible({ timeout: 2000 })) {
        this.logger.debug('Element not visible', { selector });
        return null;
      }

      const text = await element.textContent();
      return clean && text ? text.trim() : text;
    } catch (error) {
      this.logger.debug('Failed to extract text', { 
        selector, 
        error: error instanceof Error ? error.message : String(error) 
      });
      return null;
    }
  }

  async extractMultiple(page: Page, selector: string, options: ExtractionOptions = {}): Promise<string[]> {
    const { timeout = 5000, onlyVisible = true } = options;

    try {
      await page.waitForSelector(selector, { timeout });
      const elements = page.locator(selector);
      const count = await elements.count();
      
      const results: string[] = [];
      for (let i = 0; i < count; i++) {
        try {
          const element = elements.nth(i);
          
          if (onlyVisible && !await element.isVisible({ timeout: 1000 })) {
            continue;
          }
          
          const text = await element.textContent();
          if (text && text.trim()) {
            const cleanedText = text.trim();
            if (!results.includes(cleanedText)) {
              results.push(cleanedText);
            }
          }
        } catch (error) {
          continue;
        }
      }
      
      return results;
    } catch (error) {
      this.logger.debug('Failed to extract multiple elements', { 
        selector, 
        error: error instanceof Error ? error.message : String(error) 
      });
      return [];
    }
  }

  async extractPageContent(page: Page): Promise<PageContentResult> {
    try {
      await page.waitForLoadState('networkidle', { timeout: 15000 });

      // Extract title
      let title = await page.evaluate(() => document.title) || '';
      if (!title) {
        const titleSelectors = ['h1', 'h2', '.title', '.page-title'];
        for (const selector of titleSelectors) {
          try {
            const element = page.locator(selector).first();
            if (await element.isVisible({ timeout: 2000 })) {
              const titleText = await element.textContent();
              if (titleText?.trim()) {
                title = titleText.trim();
                break;
              }
            }
          } catch (error) {
            continue;
          }
        }
      }

      // First, expand any collapsed navigation elements
      await this.expandCollapsedNavigation(page);

      // Extract ALL potential links from ALL attributes on ALL elements
      const links = await page.evaluate(() => {
        const currentUrl = window.location.href;
        const currentOrigin = window.location.origin;
        const foundLinks = new Set<string>();

        // Get all elements in the document
        const allElements = document.querySelectorAll('*');
        
        for (const element of Array.from(allElements)) {
          // Check every attribute on every element
          for (let i = 0; i < element.attributes.length; i++) {
            const attr = element.attributes[i];
            const value = attr.value;
            
            if (!value || typeof value !== 'string') continue;
            
            // Check if attribute value looks like a link
            if (value.startsWith('http://') || value.startsWith('https://')) {
              // Full URL
              foundLinks.add(value);
            } else if (value.startsWith('/') && !value.startsWith('/#')) {
              // Relative path from root (not same-page anchor)
              if (value.length > 1) { // Not just "/"
                try {
                  const fullUrl = new URL(value, currentOrigin).href;
                  foundLinks.add(fullUrl);
                } catch (e) {
                  // Skip invalid URLs
                }
              }
            }
            // Skip: same-page anchors (/#something), relative paths without leading slash, 
            // mailto:, tel:, javascript:, etc.
          }
        }

        // Convert Set to Array and filter out invalid URLs
        return Array.from(foundLinks).filter(url => {
          try {
            new URL(url);
            return true;
          } catch (e) {
            return false;
          }
        });
      });

      return {
        title,
        content: '', // Will be filled by selector-based extraction
        links,
        codeExamples: [], // Will be extracted if needed
        url: page.url(),
      };
    } catch (error) {
      this.logger.error('Failed to extract page content', { 
        error: error instanceof Error ? error.message : String(error), 
        url: page.url() 
      });
      return {
        title: '',
        content: '',
        links: [],
        codeExamples: [],
        url: page.url(),
      };
    }
  }

  private async expandCollapsedNavigation(page: Page): Promise<void> {
    try {
      // Use page.evaluate to run JavaScript in the browser context for SPA compatibility
      const expandedCount = await page.evaluate(async () => {
        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        
        // Find all elements that might be collapsible navigation
        const collapsibleSelectors = [
          '[aria-expanded="false"]',
          '[aria-collapsed="true"]',
          '.collapsed',
          '.closed',
          '[data-expanded="false"]',
          '[data-collapsed="true"]',
          'button[aria-expanded="false"]',
          'a[aria-expanded="false"]',
          'div[aria-expanded="false"]',
          // Common navigation patterns
          'nav [aria-expanded="false"]',
          '.nav [aria-expanded="false"]',
          '.navigation [aria-expanded="false"]',
          '.sidebar [aria-expanded="false"]',
          '.menu [aria-expanded="false"]',
          '.dropdown [aria-expanded="false"]'
        ];

        let expandedCount = 0;
        const processedElements = new Set<Element>();

        for (const selector of collapsibleSelectors) {
          try {
            const elements = document.querySelectorAll(selector);
            
            for (const element of Array.from(elements)) {
              if (processedElements.has(element)) continue;
              processedElements.add(element);

              // Check if element is visible and clickable
              const rect = element.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) continue;

              // Check if it's actually collapsed
              const ariaExpanded = element.getAttribute('aria-expanded');
              const ariaCollapsed = element.getAttribute('aria-collapsed');
              const dataExpanded = element.getAttribute('data-expanded');
              const dataCollapsed = element.getAttribute('data-collapsed');
              
              const isCollapsed = 
                ariaExpanded === 'false' || 
                ariaCollapsed === 'true' ||
                dataExpanded === 'false' ||
                dataCollapsed === 'true' ||
                element.classList.contains('collapsed') ||
                element.classList.contains('closed');

              if (isCollapsed) {
                try {
                  // Scroll element into view if needed
                  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  await sleep(100);

                  // Hover over the element first (some menus need hover to activate)
                  const hoverEvent = new MouseEvent('mouseenter', { bubbles: true });
                  element.dispatchEvent(hoverEvent);
                  await sleep(50);

                  // Click the element
                  const clickEvent = new MouseEvent('click', { bubbles: true });
                  element.dispatchEvent(clickEvent);
                  expandedCount++;

                  // Small delay to allow DOM to update
                  await sleep(100);

                  // Also try triggering any associated events
                  if (element.tagName === 'BUTTON' || element.tagName === 'A') {
                    const keyEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
                    element.dispatchEvent(keyEvent);
                  }

                  await sleep(50);
                } catch (e) {
                  // Continue with next element if this one fails
                  continue;
                }
              }
            }
          } catch (e) {
            // Continue with next selector if this one fails
            continue;
          }
        }

        return expandedCount;
      });

      if (expandedCount > 0) {
        this.logger.info(`Expanded ${expandedCount} collapsed navigation elements`);
        // Wait a bit for any animations or dynamic content to load
        await page.waitForTimeout(500);
      }
    } catch (error) {
      this.logger.debug('Failed to expand collapsed navigation', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  async parseSitemap(baseUrl: string): Promise<SitemapResult | null> {
    try {
      this.logger.info('Parsing sitemap for domain', { baseUrl });
      const parser = new SitemapParser(baseUrl);
      const result = await parser.parse();
      
      if ('error' in result) {
        this.logger.warn('Failed to parse sitemap', { baseUrl, error: result.error });
        return null;
      }
      
      this.logger.info('Successfully parsed sitemap', { 
        baseUrl, 
        type: result.type,
        urlCount: result.type === 'urlset' ? result.urls.length : 
                  result.type === 'sitemapindex' ? result.sitemaps.length : 0
      });
      
      return result;
    } catch (error) {
      this.logger.error('Error parsing sitemap', { 
        baseUrl, 
        error: error instanceof Error ? error.message : String(error) 
      });
      return null;
    }
  }

  filterInternalLinks(links: string[], baseUrl: string, includeSubdomains: boolean = false): string[] {
    const baseDomain = new URL(baseUrl).hostname;
    const internalLinks: string[] = [];

    for (const link of links) {
      try {
        const parsed = new URL(link);
        if (this.isAllowedDomain(parsed.hostname, baseDomain, includeSubdomains) || !parsed.hostname) {
          // Convert relative to absolute
          const absoluteLink = parsed.hostname ? link : new URL(link, baseUrl).href;
          internalLinks.push(absoluteLink);
        }
      } catch (error) {
        continue;
      }
    }

    return Array.from(new Set(internalLinks)); // Remove duplicates
  }

  filterLinksByPatterns(links: string[], allowPatterns: string[] = [], ignorePatterns: string[] = []): string[] {
    const filtered: string[] = [];

    for (const link of links) {
      try {
        const result = PatternMatcher.shouldAllowUrl(link, allowPatterns, ignorePatterns);
        if (result.allowed) {
          filtered.push(link);
        }
      } catch (error) {
        continue;
      }
    }

    return Array.from(new Set(filtered)); // Remove duplicates
  }

  private isAllowedDomain(urlDomain: string, baseDomain: string, includeSubdomains: boolean): boolean {
    if (!urlDomain) return false;
    
    if (urlDomain === baseDomain) return true;
    
    if (includeSubdomains && urlDomain.endsWith(`.${baseDomain}`)) {
      return true;
    }
    
    return false;
  }


  async close(): Promise<void> {
    if (this.browserContext) {
      await this.browserContext.close();
      this.browserContext = null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}