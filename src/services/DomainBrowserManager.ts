/**
 * Domain-based browser context manager for coordinated web scraping
 */

import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { URL } from 'url';
import { BrowserManager, type BrowserManagerConfig } from './BrowserManager.js';
import { Logger } from '../utils/logger.js';
import { StoragePathResolver } from './StoragePathResolver.js';

export interface DomainBrowserManagerConfig {
  baseDataDir?: string;
  defaultBrowserConfig?: Partial<BrowserManagerConfig>;
}

export class DomainBrowserManager {
  private static _instance: DomainBrowserManager | null = null;
  private _initialized = false;
  private domainBrowsers: Map<string, BrowserManager> = new Map();
  private activeScraping: Map<string, Set<string>> = new Map(); // domain -> source_ids
  private baseDataDir: string;
  private defaultBrowserConfig: BrowserManagerConfig;
  private logger: Logger;

  private constructor(config: DomainBrowserManagerConfig = {}) {
    this.logger = new Logger('domain-browser-manager');

    // Use StoragePathResolver for project-local support
    if (config.baseDataDir) {
      this.baseDataDir = config.baseDataDir;
    } else {
      const storageConfig = StoragePathResolver.getStorageConfig({ preferLocal: true });
      const basePath = StoragePathResolver.getBaseStoragePath(storageConfig);
      this.baseDataDir = join(basePath, 'browser_data');
    }

    this.defaultBrowserConfig = {
      browserType: 'chrome',
      headless: true,
      retryCount: 3,
      retryDelay: 2000,
      ...config.defaultBrowserConfig,
    };

    // Ensure base data directory exists
    if (!existsSync(this.baseDataDir)) {
      mkdirSync(this.baseDataDir, { recursive: true });
    }
  }

  static getInstance(config?: DomainBrowserManagerConfig): DomainBrowserManager {
    if (!DomainBrowserManager._instance) {
      DomainBrowserManager._instance = new DomainBrowserManager(config);
    }
    return DomainBrowserManager._instance;
  }

  private extractDomain(url: string): string {
    try {
      const parsed = new URL(url);
      let domain = parsed.hostname.toLowerCase();
      
      // Remove default ports
      if (domain.endsWith(':80') && parsed.protocol === 'http:') {
        domain = domain.slice(0, -3);
      } else if (domain.endsWith(':443') && parsed.protocol === 'https:') {
        domain = domain.slice(0, -4);
      }
      
      // Make folder-friendly
      const folderName = domain
        .replace(/[.:/\\?<>|*"]/g, '_')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 50);
      
      return folderName || 'unknown_domain';
    } catch (error) {
      this.logger.warn('Failed to extract domain from URL', { url, error });
      return 'unknown_domain';
    }
  }

  async getBrowserForDomain(url: string, sourceId: string): Promise<{ browser: BrowserManager; isNew: boolean }> {
    const domain = this.extractDomain(url);
    
    // Track this source as active for this domain
    if (!this.activeScraping.has(domain)) {
      this.activeScraping.set(domain, new Set());
    }
    this.activeScraping.get(domain)!.add(sourceId);
    
    // Return existing browser if available
    if (this.domainBrowsers.has(domain)) {
      this.logger.info('Reusing existing browser for domain', { domain, sourceId });
      return { browser: this.domainBrowsers.get(domain)!, isNew: false };
    }
    
    // Create new browser for this domain
    this.logger.info('Creating new browser for domain', { domain, sourceId });
    
    try {
      const domainDataDir = join(this.baseDataDir, domain, 'persist_dir');
      if (!existsSync(domainDataDir)) {
        mkdirSync(domainDataDir, { recursive: true });
      }
      
      const browserConfig: BrowserManagerConfig = {
        ...this.defaultBrowserConfig,
        userDataDir: domainDataDir,
      };
      
      const browser = new BrowserManager(browserConfig);
      await browser.initialize();
      
      // Store browser for this domain
      this.domainBrowsers.set(domain, browser);
      
      this.logger.info('Successfully created browser for domain', { domain, sourceId });
      return { browser, isNew: true };
    } catch (error) {
      this.logger.error('Failed to create browser for domain', { domain, sourceId, error });
      
      // Remove from active tracking if creation failed
      const activeSet = this.activeScraping.get(domain);
      if (activeSet) {
        activeSet.delete(sourceId);
        if (activeSet.size === 0) {
          this.activeScraping.delete(domain);
        }
      }
      
      throw error;
    }
  }

  async releaseBrowserForSource(url: string, sourceId: string): Promise<void> {
    const domain = this.extractDomain(url);
    
    const activeSet = this.activeScraping.get(domain);
    if (activeSet && activeSet.has(sourceId)) {
      activeSet.delete(sourceId);
      this.logger.info('Released browser for source', { domain, sourceId });
      
      // If no more sources are using this domain, keep browser for potential reuse
      if (activeSet.size === 0) {
        this.logger.info('No more active sources for domain', { domain });
        // Note: We keep the browser alive for potential reuse
      }
    }
  }

  async cleanupDomain(url: string, force: boolean = false): Promise<boolean> {
    const domain = this.extractDomain(url);
    
    // Check if domain is still active
    const activeSet = this.activeScraping.get(domain);
    if (!force && activeSet && activeSet.size > 0) {
      this.logger.info('Cannot cleanup domain - still has active sources', { 
        domain, 
        activeSources: Array.from(activeSet) 
      });
      return false;
    }
    
    // Clean up browser if it exists
    if (this.domainBrowsers.has(domain)) {
      try {
        const browser = this.domainBrowsers.get(domain)!;
        await browser.close();
        this.domainBrowsers.delete(domain);
        this.logger.info('Successfully cleaned up browser for domain', { domain });
      } catch (error) {
        this.logger.warn('Failed to cleanup browser for domain', { domain, error });
      }
    }
    
    // Clean up tracking data
    this.activeScraping.delete(domain);
    return true;
  }

  async cleanupAllDomains(force: boolean = false): Promise<Record<string, boolean>> {
    const cleanupResults: Record<string, boolean> = {};
    const domainsToCleanup = Array.from(this.domainBrowsers.keys());
    
    for (const domain of domainsToCleanup) {
      try {
        const fakeUrl = `https://${domain.replace(/_/g, '.')}`;
        const result = await this.cleanupDomain(fakeUrl, force);
        cleanupResults[domain] = result;
      } catch (error) {
        this.logger.error('Failed to cleanup domain', { domain, error });
        cleanupResults[domain] = false;
      }
    }
    
    return cleanupResults;
  }

  getDomainStatus(): Record<string, {
    browserActive: boolean;
    activeSources: string[];
    sourceCount: number;
  }> {
    const status: Record<string, {
      browserActive: boolean;
      activeSources: string[];
      sourceCount: number;
    }> = {};
    
    for (const domain of this.domainBrowsers.keys()) {
      const activeSources = Array.from(this.activeScraping.get(domain) || []);
      status[domain] = {
        browserActive: true,
        activeSources,
        sourceCount: activeSources.length,
      };
    }
    
    return status;
  }

  isDomainBusy(url: string): boolean {
    const domain = this.extractDomain(url);
    const activeSet = this.activeScraping.get(domain);
    return activeSet ? activeSet.size > 0 : false;
  }

  markDomainBusy(url: string, sourceId: string): void {
    const domain = this.extractDomain(url);
    
    if (!this.activeScraping.has(domain)) {
      this.activeScraping.set(domain, new Set());
    }
    
    this.activeScraping.get(domain)!.add(sourceId);
    this.logger.info('Marked domain as busy', { domain, sourceId });
  }

  releaseDomain(url: string, sourceId: string): void {
    const domain = this.extractDomain(url);
    
    const activeSet = this.activeScraping.get(domain);
    if (activeSet && activeSet.has(sourceId)) {
      activeSet.delete(sourceId);
      this.logger.info('Released domain for source', { domain, sourceId });
    }
  }

  async waitForDomainAvailability(url: string, timeout: number = 300000): Promise<boolean> {
    const domain = this.extractDomain(url);
    
    if (!this.isDomainBusy(url)) {
      return true;
    }
    
    this.logger.info('Domain is busy, waiting for availability', { domain, timeout });
    
    const startTime = Date.now();
    while (this.isDomainBusy(url)) {
      if (Date.now() - startTime > timeout) {
        this.logger.warn('Timeout waiting for domain availability', { domain });
        return false;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    this.logger.info('Domain became available', { domain });
    return true;
  }

  // Get the persistent directory for a domain
  getDomainDataDir(url: string): string {
    const domain = this.extractDomain(url);
    return join(this.baseDataDir, domain, 'persist_dir');
  }

  // Get statistics about managed domains
  getStatistics(): {
    totalDomains: number;
    activeDomains: number;
    totalActiveSources: number;
    domainBreakdown: Record<string, number>;
  } {
    const domainBreakdown: Record<string, number> = {};
    let totalActiveSources = 0;
    
    for (const [domain, activeSet] of this.activeScraping.entries()) {
      const count = activeSet.size;
      domainBreakdown[domain] = count;
      totalActiveSources += count;
    }
    
    return {
      totalDomains: this.domainBrowsers.size,
      activeDomains: this.activeScraping.size,
      totalActiveSources,
      domainBreakdown,
    };
  }
}

// Export singleton instance
export const domainBrowserManager = DomainBrowserManager.getInstance();