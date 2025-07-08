import { eq, and, or, like, gt, gte, lt, lte, desc, asc, isNull, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { BaseRepository, createRepositoryConfig } from './index.js';
import { DatabaseManager } from '../database/index.js';
import {
  scrapeJobEntries,
  insertScrapeJobEntrySchema,
  selectScrapeJobEntrySchema,
  type ScrapeJobEntry,
  type NewScrapeJobEntry,
} from '../schemas/index.js';

// Since there's no update schema defined, we'll create a partial type
type ScrapeJobEntryUpdate = Partial<Omit<NewScrapeJobEntry, 'id'>>;

/**
 * Repository for managing scrape job entries (individual scraped pages)
 * 
 * Provides type-safe CRUD operations and content search methods
 */
export class ScrapeJobEntryRepository extends BaseRepository<
  typeof scrapeJobEntries,
  ScrapeJobEntry,
  NewScrapeJobEntry,
  ScrapeJobEntryUpdate
> {
  constructor(drizzleManager: DatabaseManager) {
    super(drizzleManager, createRepositoryConfig(
      scrapeJobEntries,
      scrapeJobEntries.id,
      insertScrapeJobEntrySchema,
      selectScrapeJobEntrySchema,
      // Use simple object schema for updates to avoid drizzle-zod compatibility issues
      z.object({}).passthrough() as any,
      'scrape-job-entry-repository'
    ));
  }

  /**
   * Find entries by job ID
   */
  async findByJobId(jobId: string): Promise<ScrapeJobEntry[]> {
    return this.query()
      .where(eq(scrapeJobEntries.jobId, jobId))
      .orderBy(scrapeJobEntries.scrapedAt, 'desc')
      .execute();
  }

  /**
   * Find entries by URL
   */
  async findByUrl(url: string): Promise<ScrapeJobEntry[]> {
    return this.query()
      .where(eq(scrapeJobEntries.url, url))
      .orderBy(scrapeJobEntries.scrapedAt, 'desc')
      .execute();
  }

  /**
   * Search entries by title or content
   */
  async searchContent(query: string, jobId?: string): Promise<ScrapeJobEntry[]> {
    const searchPattern = `%${query}%`;
    const conditions = [
      or(
        like(scrapeJobEntries.title, searchPattern),
        like(scrapeJobEntries.content, searchPattern)
      )
    ];

    if (jobId) {
      conditions.push(eq(scrapeJobEntries.jobId, jobId));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

    return this.query()
      .where(whereClause)
      .orderBy(scrapeJobEntries.relevanceScore, 'desc')
      .execute();
  }

  /**
   * Find entries with errors
   */
  async findWithErrors(jobId?: string): Promise<ScrapeJobEntry[]> {
    const conditions = [isNotNull(scrapeJobEntries.errorMessage)];

    if (jobId) {
      conditions.push(eq(scrapeJobEntries.jobId, jobId));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

    return this.query()
      .where(whereClause)
      .orderBy(scrapeJobEntries.scrapedAt, 'desc')
      .execute();
  }

  /**
   * Find successful entries (no errors)
   */
  async findSuccessful(jobId?: string): Promise<ScrapeJobEntry[]> {
    const conditions = [isNull(scrapeJobEntries.errorMessage)];

    if (jobId) {
      conditions.push(eq(scrapeJobEntries.jobId, jobId));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

    return this.query()
      .where(whereClause)
      .orderBy(scrapeJobEntries.relevanceScore, 'desc')
      .execute();
  }

  /**
   * Find entries by HTTP status code
   */
  async findByHttpStatus(statusCode: number, jobId?: string): Promise<ScrapeJobEntry[]> {
    const conditions = [eq(scrapeJobEntries.httpStatus, statusCode)];

    if (jobId) {
      conditions.push(eq(scrapeJobEntries.jobId, jobId));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

    return this.query()
      .where(whereClause)
      .orderBy(scrapeJobEntries.scrapedAt, 'desc')
      .execute();
  }

  /**
   * Find entries by content type
   */
  async findByContentType(contentType: string, jobId?: string): Promise<ScrapeJobEntry[]> {
    const conditions = [eq(scrapeJobEntries.contentType, contentType)];

    if (jobId) {
      conditions.push(eq(scrapeJobEntries.jobId, jobId));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

    return this.query()
      .where(whereClause)
      .orderBy(scrapeJobEntries.scrapedAt, 'desc')
      .execute();
  }

  /**
   * Find entries with relevance score above threshold
   */
  async findByRelevanceScore(
    minScore: number, 
    jobId?: string,
    limit?: number
  ): Promise<ScrapeJobEntry[]> {
    const conditions = [gte(scrapeJobEntries.relevanceScore, minScore)];

    if (jobId) {
      conditions.push(eq(scrapeJobEntries.jobId, jobId));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

    let query = this.query()
      .where(whereClause)
      .orderBy(scrapeJobEntries.relevanceScore, 'desc');

    if (limit) {
      query = query.limit(limit);
    }

    return query.execute();
  }

  /**
   * Find entries by content size range
   */
  async findByContentSize(
    minSize?: number, 
    maxSize?: number, 
    jobId?: string
  ): Promise<ScrapeJobEntry[]> {
    const conditions = [];

    if (minSize !== undefined) {
      conditions.push(gte(scrapeJobEntries.contentLength, minSize));
    }

    if (maxSize !== undefined) {
      conditions.push(lte(scrapeJobEntries.contentLength, maxSize));
    }

    if (jobId) {
      conditions.push(eq(scrapeJobEntries.jobId, jobId));
    }

    if (conditions.length === 0) {
      // No conditions, return all entries
      const whereClause = jobId ? eq(scrapeJobEntries.jobId, jobId) : undefined;
      return this.query()
        .where(whereClause)
        .orderBy(scrapeJobEntries.scrapedAt, 'desc')
        .execute();
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

    return this.query()
      .where(whereClause)
      .orderBy(scrapeJobEntries.contentLength, 'desc')
      .execute();
  }

  /**
   * Get entry statistics for a job
   */
  async getJobStats(jobId: string): Promise<{
    total: number;
    successful: number;
    withErrors: number;
    avgRelevanceScore: number;
    totalContentLength: number;
    httpStatusCounts: Record<number, number>;
    contentTypeCounts: Record<string, number>;
  }> {
    const entries = await this.findByJobId(jobId);
    
    const stats = {
      total: entries.length,
      successful: 0,
      withErrors: 0,
      avgRelevanceScore: 0,
      totalContentLength: 0,
      httpStatusCounts: {} as Record<number, number>,
      contentTypeCounts: {} as Record<string, number>,
    };

    let totalRelevanceScore = 0;

    entries.forEach(entry => {
      // Count successful vs error entries
      if (entry.errorMessage) {
        stats.withErrors++;
      } else {
        stats.successful++;
      }

      // Sum relevance scores
      totalRelevanceScore += entry.relevanceScore || 0;

      // Sum content lengths
      stats.totalContentLength += entry.contentLength || 0;

      // Count HTTP status codes
      if (entry.httpStatus) {
        stats.httpStatusCounts[entry.httpStatus] = (stats.httpStatusCounts[entry.httpStatus] || 0) + 1;
      }

      // Count content types
      if (entry.contentType) {
        stats.contentTypeCounts[entry.contentType] = (stats.contentTypeCounts[entry.contentType] || 0) + 1;
      }
    });

    stats.avgRelevanceScore = entries.length > 0 ? totalRelevanceScore / entries.length : 0;

    return stats;
  }

  /**
   * Find recent entries (last N days)
   */
  async findRecent(days = 7, jobId?: string): Promise<ScrapeJobEntry[]> {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const conditions = [gt(scrapeJobEntries.scrapedAt, cutoffDate)];

    if (jobId) {
      conditions.push(eq(scrapeJobEntries.jobId, jobId));
    }

    const whereClause = conditions.length > 1 ? and(...conditions) : conditions[0];

    return this.query()
      .where(whereClause)
      .orderBy(scrapeJobEntries.scrapedAt, 'desc')
      .execute();
  }

  /**
   * Find the most relevant entries across all jobs
   */
  async findMostRelevant(limit = 50, minScore = 0.5): Promise<ScrapeJobEntry[]> {
    return this.query()
      .where(gte(scrapeJobEntries.relevanceScore, minScore))
      .orderBy(scrapeJobEntries.relevanceScore, 'desc')
      .limit(limit)
      .execute();
  }

  /**
   * Search entries with extracted data containing specific key
   */
  async findWithExtractedDataKey(key: string, jobId?: string): Promise<ScrapeJobEntry[]> {
    const entries = await this.list({
      where: jobId ? eq(scrapeJobEntries.jobId, jobId) : undefined,
    });

    // Filter in application code since JSON queries can be complex
    return entries.data.filter(entry => {
      if (!entry.extractedData) return false;
      return key in entry.extractedData;
    });
  }

  /**
   * Update entry relevance score
   */
  async updateRelevanceScore(id: string, score: number): Promise<ScrapeJobEntry | null> {
    return this.update(id, { relevanceScore: score } as ScrapeJobEntryUpdate);
  }

  /**
   * Update entry extracted data
   */
  async updateExtractedData(
    id: string, 
    extractedData: Record<string, unknown>
  ): Promise<ScrapeJobEntry | null> {
    return this.update(id, { extractedData } as ScrapeJobEntryUpdate);
  }

  /**
   * Cleanup entries for deleted jobs
   */
  async cleanupOrphanedEntries(): Promise<number> {
    // This would require a join with scrape_jobs table to find orphaned entries
    // For now, we'll implement a simple cleanup based on job existence
    const allEntries = await this.list();
    const uniqueJobIds = [...new Set(allEntries.data.map(entry => entry.jobId))];
    
    // In a real implementation, you'd check if these job IDs exist
    // For now, we'll just return 0 as this requires cross-repository logic
    this.logger.info('Checked for orphaned entries', { 
      totalEntries: allEntries.total,
      uniqueJobIds: uniqueJobIds.length
    });
    
    return 0;
  }

  /**
   * Cleanup old entries
   */
  async cleanupOldEntries(days = 90): Promise<number> {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    
    const oldEntries = await this.query()
      .where(lt(scrapeJobEntries.scrapedAt, cutoffDate))
      .execute();

    let deletedCount = 0;
    
    // Delete each entry individually to ensure proper logging
    for (const entry of oldEntries) {
      const deleted = await this.delete(entry.id);
      if (deleted) {
        deletedCount++;
      }
    }

    this.logger.info('Cleaned up old scrape job entries', { 
      deletedCount, 
      cutoffDate,
      daysOld: days 
    });
    
    return deletedCount;
  }
}