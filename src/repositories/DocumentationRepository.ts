import { eq, and, or, like, desc, asc, isNull, lt } from 'drizzle-orm';
import { BaseRepository, createRepositoryConfig } from './index.js';
import { DatabaseManager } from '../database/index.js';
import {
  documentationSources,
  insertDocumentationSourceSchema,
  selectDocumentationSourceSchema,
  updateDocumentationSourceSchema,
  type DocumentationSource,
  type NewDocumentationSource,
  type DocumentationSourceUpdate,
  type SourceType,
  type DocumentationStatus,
  type UpdateFrequency,
} from '../schemas/index.js';

/**
 * Repository for managing documentation sources
 * 
 * Provides type-safe CRUD operations and documentation-specific query methods
 */
export class DocumentationRepository extends BaseRepository<
  typeof documentationSources,
  DocumentationSource,
  NewDocumentationSource,
  DocumentationSourceUpdate
> {
  constructor(drizzleManager: DatabaseManager) {
    super(drizzleManager, createRepositoryConfig(
      documentationSources,
      documentationSources.id,
      insertDocumentationSourceSchema,
      selectDocumentationSourceSchema,
      updateDocumentationSourceSchema,
      'documentation-repository'
    ));
  }

  /**
   * Find documentation sources by URL
   */
  async findByUrl(url: string): Promise<DocumentationSource | null> {
    return this.query()
      .where(eq(documentationSources.url, url))
      .first();
  }

  /**
   * Find documentation sources by source type
   */
  async findBySourceType(sourceType: SourceType): Promise<DocumentationSource[]> {
    return this.query()
      .where(eq(documentationSources.sourceType, sourceType))
      .orderBy(documentationSources.updatedAt, 'desc')
      .execute();
  }

  /**
   * Find documentation sources by status
   */
  async findByStatus(status: DocumentationStatus): Promise<DocumentationSource[]> {
    return this.query()
      .where(eq(documentationSources.status, status))
      .orderBy(documentationSources.updatedAt, 'desc')
      .execute();
  }

  /**
   * Search documentation sources by name or URL
   */
  async search(query: string): Promise<DocumentationSource[]> {
    const searchPattern = `%${query}%`;
    return this.query()
      .where(or(
        like(documentationSources.name, searchPattern),
        like(documentationSources.url, searchPattern)
      ))
      .orderBy(documentationSources.updatedAt, 'desc')
      .execute();
  }

  /**
   * Find sources that need to be scraped based on update frequency
   */
  async findStaleForUpdate(): Promise<DocumentationSource[]> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Get all sources that need updating based on their frequency
    const sources = await this.query()
      .where(and(
        eq(documentationSources.status, 'completed'),
        or(
          // Daily sources not scraped in last day
          and(
            eq(documentationSources.updateFrequency, 'daily'),
            or(
              isNull(documentationSources.lastScraped),
              // Use text comparison for ISO strings
              lt(documentationSources.lastScraped, oneDayAgo)
            )
          ),
          // Weekly sources not scraped in last week
          and(
            eq(documentationSources.updateFrequency, 'weekly'),
            or(
              isNull(documentationSources.lastScraped),
              lt(documentationSources.lastScraped, oneWeekAgo)
            )
          ),
          // Monthly sources not scraped in last month
          and(
            eq(documentationSources.updateFrequency, 'monthly'),
            or(
              isNull(documentationSources.lastScraped),
              lt(documentationSources.lastScraped, oneMonthAgo)
            )
          )
        )
      ))
      .orderBy(documentationSources.lastScraped, 'asc')
      .execute();

    return sources;
  }

  /**
   * Find sources that have never been scraped
   */
  async findNeverScraped(): Promise<DocumentationSource[]> {
    return this.query()
      .where(or(
        isNull(documentationSources.lastScraped),
        eq(documentationSources.status, 'not_started')
      ))
      .orderBy(documentationSources.createdAt, 'asc')
      .execute();
  }

  /**
   * Find sources that failed scraping
   */
  async findFailed(): Promise<DocumentationSource[]> {
    return this.query()
      .where(eq(documentationSources.status, 'failed'))
      .orderBy(documentationSources.updatedAt, 'desc')
      .execute();
  }

  /**
   * Update source status and last scraped timestamp
   */
  async updateScrapingStatus(
    id: string, 
    status: DocumentationStatus, 
    lastScraped?: string
  ): Promise<DocumentationSource | null> {
    const updateData: Partial<DocumentationSourceUpdate> = {
      status,
      updatedAt: new Date().toISOString(),
    };

    if (lastScraped) {
      updateData.lastScraped = lastScraped;
    }

    return this.update(id, updateData as DocumentationSourceUpdate);
  }

  /**
   * Mark source as stale (needs re-scraping)
   */
  async markAsStale(id: string): Promise<DocumentationSource | null> {
    return this.updateScrapingStatus(id, 'stale');
  }

  /**
   * Mark source as completed
   */
  async markAsCompleted(id: string): Promise<DocumentationSource | null> {
    return this.updateScrapingStatus(id, 'completed', new Date().toISOString());
  }

  /**
   * Mark source as failed with error
   */
  async markAsFailed(id: string): Promise<DocumentationSource | null> {
    return this.updateScrapingStatus(id, 'failed');
  }

  /**
   * Get sources by update frequency
   */
  async findByUpdateFrequency(frequency: UpdateFrequency): Promise<DocumentationSource[]> {
    return this.query()
      .where(eq(documentationSources.updateFrequency, frequency))
      .orderBy(documentationSources.lastScraped, 'asc')
      .execute();
  }

  /**
   * Get count of sources by status
   */
  async getCountByStatus(): Promise<Record<DocumentationStatus, number>> {
    const sources = await this.list();
    
    const counts: Record<string, number> = {};
    const statusValues: DocumentationStatus[] = ['not_started', 'scraping', 'completed', 'failed', 'stale'];
    
    // Initialize all statuses with 0
    statusValues.forEach(status => {
      counts[status] = 0;
    });
    
    // Count actual statuses
    sources.data.forEach(source => {
      counts[source.status] = (counts[source.status] || 0) + 1;
    });
    
    return counts as Record<DocumentationStatus, number>;
  }

  /**
   * Get sources with specific metadata field
   */
  async findWithMetadata(metadataKey: string, metadataValue?: any): Promise<DocumentationSource[]> {
    const sources = await this.list();
    
    return sources.data.filter(source => {
      if (!source.sourceMetadata) return false;
      
      const hasKey = metadataKey in source.sourceMetadata;
      if (!metadataValue) return hasKey;
      
      return hasKey && source.sourceMetadata[metadataKey] === metadataValue;
    });
  }

  /**
   * Update source metadata
   */
  async updateMetadata(
    id: string, 
    metadata: Record<string, unknown>
  ): Promise<DocumentationSource | null> {
    return this.update(id, {
      sourceMetadata: metadata,
      updatedAt: new Date().toISOString(),
    } as DocumentationSourceUpdate);
  }

  /**
   * Cleanup old failed sources
   */
  async cleanupOldFailed(days = 30): Promise<number> {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    
    const oldFailedSources = await this.query()
      .where(and(
        eq(documentationSources.status, 'failed'),
        // Simple string comparison for ISO dates should work
        eq(documentationSources.updatedAt, cutoffDate)
      ))
      .execute();

    // Filter in application code for more precise timestamp comparison
    const toDelete = oldFailedSources.filter(source => 
      new Date(source.updatedAt).getTime() < new Date(cutoffDate).getTime()
    );

    let deletedCount = 0;
    
    // Delete each source individually to ensure proper logging
    for (const source of toDelete) {
      const deleted = await this.delete(source.id);
      if (deleted) {
        deletedCount++;
      }
    }

    this.logger.info('Cleaned up old failed documentation sources', { 
      deletedCount, 
      cutoffDate,
      daysOld: days 
    });
    
    return deletedCount;
  }
}