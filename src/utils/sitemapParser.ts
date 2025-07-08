/**
 * Simple recursive sitemap parser that converts XML to clean dict structure with language filtering
 * TypeScript port of Python SitemapParser
 */

import { parseStringPromise } from 'xml2js';
import { Logger } from './logger.js';

export interface SitemapUrl {
  url: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
  [key: string]: any;
}

export interface SitemapInfo {
  url: string;
  lastmod?: string;
  country?: string;
  language?: string;
}

export interface SitemapUrlset {
  type: 'urlset';
  url: string;
  urls: SitemapUrl[];
}

export interface SitemapIndex {
  type: 'sitemapindex';
  url: string;
  sitemaps: Array<{
    info: SitemapInfo;
    data: SitemapUrlset | SitemapIndex;
  }>;
  all_sitemaps: SitemapInfo[];
}

export interface SitemapUnknown {
  type: 'unknown';
  url: string;
  data: any;
}

export interface SitemapError {
  error: string;
}

export type SitemapResult = SitemapUrlset | SitemapIndex | SitemapUnknown | SitemapError;

export class SitemapParser {
  private baseUrl: string;
  private preferLanguage: string;
  private logger: Logger;

  constructor(baseUrl: string, preferLanguage: string = 'en') {
    const parsedUrl = new URL(baseUrl);
    this.baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
    this.preferLanguage = preferLanguage;
    this.logger = new Logger('sitemap-parser');
  }

  /**
   * Parse sitemap recursively starting from given URL or auto-discover
   */
  async parse(sitemapUrl?: string, filterLanguage: boolean = true): Promise<SitemapResult> {
    try {
      // Auto-discover sitemap URL if not provided
      if (!sitemapUrl) {
        sitemapUrl = await this.discoverSitemap();
        if (!sitemapUrl) {
          return { error: 'No sitemap found' };
        }
      }

      // Parse the sitemap recursively
      const result = await this.parseSitemap(sitemapUrl, filterLanguage);
      return result || { error: 'Failed to parse sitemap' };
    } catch (error) {
      this.logger.error('Sitemap parsing error', { error });
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Try common sitemap locations and robots.txt
   */
  private async discoverSitemap(): Promise<string | null> {
    const commonUrls = [
      '/sitemap.xml',
      '/sitemap_index.xml',
      '/sitemap-index.xml',
      '/sitemapindex.xml',
      '/sitemap0.xml',
      '/sitemap1.xml',
      '/sitemap-0.xml',
      '/sitemap-1.xml',
    ];

    for (const path of commonUrls) {
      const url = new URL(path, this.baseUrl).href;
      if (await this.urlExists(url)) {
        return url;
      }
    }

    // Check robots.txt
    const robotsUrl = new URL('/robots.txt', this.baseUrl).href;
    try {
      const response = await fetch(robotsUrl, { 
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SitemapParser/1.0)' }
      });
      
      if (response.ok) {
        const content = await response.text();
        for (const line of content.split('\n')) {
          if (line.trim().toLowerCase().startsWith('sitemap:')) {
            return line.split(':', 2)[1].trim();
          }
        }
      }
    } catch (error) {
      // Continue without robots.txt
    }

    return null;
  }

  /**
   * Check if URL returns 200
   */
  private async urlExists(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, { 
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SitemapParser/1.0)' }
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Parse a single sitemap URL recursively
   */
  private async parseSitemap(url: string, filterLanguage: boolean = true): Promise<SitemapResult | null> {
    try {
      this.logger.info('Parsing sitemap', { url });

      const response = await fetch(url, { 
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SitemapParser/1.0)' }
      });

      if (!response.ok) {
        return null;
      }

      const content = await response.text();
      const parsed = await parseStringPromise(content, { 
        explicitArray: false,
        ignoreAttrs: false,
        mergeAttrs: true
      });

      // Get the root element
      const rootKey = Object.keys(parsed)[0];
      const root = parsed[rootKey];

      if (rootKey === 'sitemapindex') {
        return await this.parseSitemapIndex(url, root, filterLanguage);
      } else if (rootKey === 'urlset') {
        return this.parseUrlset(url, root);
      } else {
        // Generic XML to dict conversion
        return {
          type: 'unknown',
          url,
          data: root,
        };
      }
    } catch (error) {
      this.logger.error('Failed to parse sitemap', { url, error });
      return null;
    }
  }

  /**
   * Parse sitemap index and recursively fetch child sitemaps with language filtering
   */
  private async parseSitemapIndex(url: string, root: any, filterLanguage: boolean = true): Promise<SitemapIndex> {
    const result: SitemapIndex = {
      type: 'sitemapindex',
      url,
      sitemaps: [],
      all_sitemaps: []
    };

    // Normalize sitemap entries to array
    const sitemaps = Array.isArray(root.sitemap) ? root.sitemap : [root.sitemap].filter(Boolean);
    
    const sitemapInfos: SitemapInfo[] = [];
    
    for (const sitemap of sitemaps) {
      if (sitemap.loc) {
        const sitemapInfo: SitemapInfo = {
          url: sitemap.loc.trim(),
          lastmod: sitemap.lastmod?.trim(),
          ...this.extractLanguageInfo(sitemap.loc)
        };
        
        sitemapInfos.push(sitemapInfo);
        result.all_sitemaps.push(sitemapInfo);
      }
    }

    // Filter for preferred language if requested
    const filteredSitemaps = filterLanguage 
      ? this.filterPreferredSitemaps(sitemapInfos)
      : sitemapInfos;

    this.logger.info(`Filtered ${sitemapInfos.length} sitemaps to ${filteredSitemaps.length} preferred language sitemaps`);

    // Recursively parse each selected sitemap
    for (const sitemapInfo of filteredSitemaps) {
      const childData = await this.parseSitemap(sitemapInfo.url, false); // Don't filter recursively
      if (childData && !('error' in childData) && childData.type !== 'unknown') {
        result.sitemaps.push({
          info: sitemapInfo,
          data: childData as SitemapUrlset | SitemapIndex
        });
      }
    }

    this.logger.info(`Parsed sitemap index with ${result.sitemaps.length} child sitemaps`);
    return result;
  }

  /**
   * Parse URL set into clean structure
   */
  private parseUrlset(url: string, root: any): SitemapUrlset {
    const result: SitemapUrlset = {
      type: 'urlset',
      url,
      urls: []
    };

    // Normalize URL entries to array
    const urls = Array.isArray(root.url) ? root.url : [root.url].filter(Boolean);

    for (const urlEntry of urls) {
      const urlData = this.parseUrl(urlEntry);
      if (urlData) {
        result.urls.push(urlData);
      }
    }

    this.logger.info(`Parsed ${result.urls.length} URLs from ${url}`);
    return result;
  }

  /**
   * Parse single URL element to dict
   */
  private parseUrl(elem: any): SitemapUrl | null {
    if (!elem.loc) {
      return null;
    }

    const urlData: SitemapUrl = {
      url: elem.loc.trim()
    };

    // Add other properties
    if (elem.lastmod) urlData.lastmod = elem.lastmod.trim();
    if (elem.changefreq) urlData.changefreq = elem.changefreq.trim();
    if (elem.priority) {
      const priority = parseFloat(elem.priority);
      if (!isNaN(priority)) {
        urlData.priority = priority;
      }
    }

    // Add any other properties
    for (const [key, value] of Object.entries(elem)) {
      if (!['loc', 'lastmod', 'changefreq', 'priority'].includes(key) && value) {
        urlData[key] = value;
      }
    }

    return urlData;
  }

  /**
   * Extract language and country codes from sitemap URL
   */
  private extractLanguageInfo(url: string): { country?: string; language?: string } {
    const patterns = [
      /\/([a-z]{2})\/([a-z]{2})\//,      // /us/en/
      /\/([a-z]{2,4})\/([a-z]{2})\//,    // /intl/en/
      /-([a-z]{2})-([a-z]{2})-/,         // -us-en-
      /_([a-z]{2})_([a-z]{2})_/,         // _us_en_
      /\/([a-z]{2})\//                   // /en/ (language only)
    ];

    for (const pattern of patterns) {
      const match = url.toLowerCase().match(pattern);
      if (match) {
        const groups = match.slice(1);
        if (groups.length === 2) {
          // Could be country/lang or region/lang
          if (['intl', 'int', 'global'].includes(groups[0])) {
            return { country: 'intl', language: groups[1] };
          } else if (groups[0].length === 2 && groups[1].length === 2) {
            return { country: groups[0], language: groups[1] };
          }
        } else if (groups.length === 1) {
          // Just language
          return { language: groups[0] };
        }
      }
    }

    return {};
  }

  /**
   * Filter sitemaps by preferred language, fallback if none found
   */
  private filterPreferredSitemaps(sitemaps: SitemapInfo[]): SitemapInfo[] {
    if (!sitemaps.length) {
      return [];
    }

    // First, try to find exact language matches
    const preferred = sitemaps.filter(s => s.language === this.preferLanguage);
    if (preferred.length > 0) {
      return preferred;
    }

    // If no preferred language found, check if we have any language-specific sitemaps
    const languageSpecific = sitemaps.filter(s => s.language !== undefined);
    if (languageSpecific.length > 0) {
      // If we have language-specific sitemaps but none in preferred language,
      // return English as fallback, or first available language
      const englishFallback = languageSpecific.filter(s => s.language === 'en');
      if (englishFallback.length > 0) {
        return englishFallback;
      }

      // Return first language found
      return languageSpecific.slice(0, 1);
    }

    // If no language info detected, return all (might be generic sitemaps)
    return sitemaps;
  }
}

/**
 * Convenience function for getting all URLs from all relevant sitemaps
 */
export async function getAllSitemapUrls(baseUrl: string, preferLanguage: string = 'en'): Promise<string[]> {
  const parser = new SitemapParser(baseUrl, preferLanguage);
  const sitemapData = await parser.parse();

  if ('error' in sitemapData) {
    return [];
  }

  const urls: string[] = [];

  function extractUrls(data: SitemapResult): void {
    if ('error' in data) return;
    
    if (data.type === 'urlset') {
      urls.push(...data.urls.map(url => url.url));
    } else if (data.type === 'sitemapindex') {
      for (const sitemap of data.sitemaps) {
        extractUrls(sitemap.data);
      }
    }
  }

  extractUrls(sitemapData);
  return urls;
}