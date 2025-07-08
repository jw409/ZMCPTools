import { DatabaseManager } from '../database/index.js';
import { DocumentationRepository } from '../repositories/DocumentationRepository.js';
import type { DocumentationSource, SourceType, DocumentationStatus } from '../schemas/index.js';

export interface DocumentationSourceSummary {
  id: string;
  name: string;
  url: string;
  sourceType: SourceType;
  entryCount: number;
  lastScrapedAt: string | null;
  createdAt: string;
}

/**
 * Service for managing documentation sources and metadata
 */
export class DocumentationService {
  private documentationRepository: DocumentationRepository;

  constructor(private db: DatabaseManager) {
    this.documentationRepository = new DocumentationRepository(this.db);
  }

  /**
   * List all documentation sources with summary information
   */
  async listDocumentationSources(): Promise<DocumentationSourceSummary[]> {
    const sources = await this.documentationRepository.findAll();
    
    return sources.map(source => ({
      id: source.id,
      name: source.name || `Documentation from ${new URL(source.url).hostname}`,
      url: source.url,
      sourceType: source.sourceType,
      entryCount: this.estimateEntryCount(source),
      lastScrapedAt: source.lastScraped,
      createdAt: source.createdAt
    }));
  }

  /**
   * Get a specific documentation source by ID
   */
  async getDocumentationSource(id: string): Promise<DocumentationSource | null> {
    return await this.documentationRepository.findById(id);
  }

  /**
   * Get documentation sources by type
   */
  async getDocumentationSourcesByType(sourceType: SourceType): Promise<DocumentationSource[]> {
    return await this.documentationRepository.findBySourceType(sourceType);
  }

  /**
   * Get recently updated documentation sources
   */
  async getRecentlyUpdatedSources(limit: number = 10): Promise<DocumentationSource[]> {
    return await this.documentationRepository.findRecentlyUpdated(limit);
  }

  /**
   * Get active documentation sources
   */
  async getActiveSources(): Promise<DocumentationSource[]> {
    return await this.documentationRepository.findByStatus('completed');
  }

  /**
   * Estimate the number of entries for a documentation source
   * This is a placeholder - in a real implementation, you might query
   * a related entries table or store this information
   */
  private estimateEntryCount(source: DocumentationSource): number {
    // Placeholder logic based on source characteristics
    if (source.sourceType === 'api') {
      return 50; // APIs typically have many endpoints
    } else if (source.sourceType === 'guide') {
      return 20; // Guides have multiple pages
    } else if (source.sourceType === 'reference') {
      return 100; // Reference docs are comprehensive
    } else {
      return 10; // Default for tutorials and other types
    }
  }
}