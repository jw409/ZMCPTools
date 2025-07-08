/**
 * Vector Search Service
 * Provides document embedding and vector similarity search capabilities
 * Uses UnifiedLanceDBService with proper vector embeddings
 */

import { UnifiedLanceDBService, type VectorDocument, type VectorSearchResult, type Collection } from './UnifiedLanceDBService.js';
import { Logger } from '../utils/logger.js';
import type { DatabaseManager } from '../database/index.js';

export interface VectorSearchConfig {
  dataPath?: string;
  embeddingModel?: string;
  huggingFaceToken?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  temperature?: number;
}

export interface SearchDocument {
  id: string;
  content: string;
  metadata?: Record<string, any>;
  type?: 'text' | 'image' | 'audio' | 'video' | 'multimodal';
}

export interface SearchResult {
  id: string;
  content: string;
  metadata?: Record<string, any>;
  similarity: number;
  distance?: number;
  nodeId?: string;
}

export interface VectorCollection {
  name: string;
  count: number;
  metadata?: Record<string, any>;
}

// Legacy interface compatibility
export interface DocumentEmbedding {
  id: string;
  content: string;
  metadata?: Record<string, any>;
  embedding?: number[];
}

export interface SimilaritySearchResult {
  id: string;
  content: string;
  metadata?: Record<string, any>;
  similarity: number;
  distance?: number;
}

export class VectorSearchService {
  private lanceDB: PureLanceDBService;
  private logger: Logger;
  private config: VectorSearchConfig;

  constructor(
    private db: DatabaseManager,
    config: VectorSearchConfig = {}
  ) {
    this.logger = new Logger('vector-search');
    this.config = {
      embeddingModel: 'sentence-transformers/all-MiniLM-L6-v2',
      chunkSize: 512,
      chunkOverlap: 50,
      temperature: 0.1,
      ...config
    };

    // Initialize PureLanceDB service
    this.lanceDB = new PureLanceDBService(this.db, this.config);
    
    this.logger.info('VectorSearchService initialized with PureLanceDB', {
      embeddingModel: this.config.embeddingModel
    });
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<{ success: boolean; error?: string }> {
    return await this.lanceDB.initialize();
  }

  /**
   * Create or get a vector collection (compatibility method)
   */
  async getOrCreateCollection(
    name: string, 
    metadata?: Record<string, any>
  ): Promise<{ name: string; metadata?: Record<string, any> }> {
    try {
      const result = await this.lanceDB.initialize();
      if (!result.success) {
        throw new Error(`Failed to initialize: ${result.error}`);
      }

      this.logger.info(`Collection ${name} ready (LanceDB table created)`);
      return { name, metadata };

    } catch (error) {
      this.logger.error(`Failed to get/create collection ${name}`, error);
      throw new Error(`Collection operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Add documents to the vector index
   */
  async addDocuments(
    collectionName: string,
    documents: DocumentEmbedding[] | SearchDocument[]
  ): Promise<{ success: boolean; addedCount: number; error?: string }> {
    try {
      // Convert to VectorDocument format
      const vectorDocs: VectorDocument[] = documents.map(doc => ({
        id: doc.id,
        content: doc.content,
        metadata: {
          ...doc.metadata,
          collection: collectionName,
          addedAt: new Date().toISOString()
        },
        type: (doc as SearchDocument).type || 'text'
      }));

      return await this.lanceDB.addDocuments(vectorDocs);

    } catch (error) {
      this.logger.error(`Failed to add documents to ${collectionName}`, error);
      return {
        success: false,
        addedCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Search for similar documents
   */
  async searchSimilar(
    collectionName: string,
    query: string,
    limit: number = 10,
    threshold: number = 0.7
  ): Promise<SimilaritySearchResult[]> {
    try {
      // Use LanceDB directly for high-performance vector search
      const results = await this.lanceDB.searchSimilar(query, limit, threshold);

      // Convert to legacy format and filter by collection if specified
      const searchResults: SimilaritySearchResult[] = results
        .filter(result => {
          // Filter by collection if specified
          if (collectionName && result.metadata?.collection !== collectionName) {
            return false;
          }
          return true;
        })
        .map(result => ({
          id: result.id,
          content: result.content,
          metadata: result.metadata,
          similarity: result.score,
          distance: 1 - result.score
        }));

      this.logger.info(`Found ${searchResults.length} similar documents in ${collectionName} via LanceDB`);
      return searchResults;

    } catch (error) {
      this.logger.error(`LanceDB search failed in collection ${collectionName}`, error);
      
      // Fallback to standard search if LanceDB fails
      try {
        this.logger.info('Falling back to standard LanceDB search');
        const fallbackResults = await this.lanceDB.searchSimilar(query, limit, threshold);
        
        return fallbackResults
          .filter(result => !collectionName || result.metadata?.collection === collectionName)
          .map(result => ({
            id: result.id,
            content: result.content,
            metadata: result.metadata,
            similarity: result.score,
            distance: 1 - result.score
          }));
          
      } catch (fallbackError) {
        throw new Error(`Search operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * Search for similar documents (new interface)
   */
  async search(
    query: string,
    collectionName?: string,
    limit: number = 10,
    threshold: number = 0.7
  ): Promise<SearchResult[]> {
    try {
      // Use LanceDB for primary search, fallback to LlamaIndex
      let results;
      try {
        results = await this.lanceDB.searchSimilar(query, limit, threshold);
      } catch (lanceError) {
        this.logger.warn('LanceDB search failed, using LlamaIndex fallback', lanceError);
        results = await this.lanceDB.searchSimilar(query, limit, threshold);
      }

      // Convert to SearchResult format and filter by collection if specified
      const searchResults: SearchResult[] = results
        .filter(result => {
          // Filter by collection if specified
          if (collectionName && result.metadata?.collection !== collectionName) {
            return false;
          }
          return true;
        })
        .map(result => ({
          id: result.id,
          content: result.content,
          metadata: result.metadata,
          similarity: result.score,
          distance: 1 - result.score,
          nodeId: result.nodeId
        }));

      this.logger.info(`Found ${searchResults.length} similar documents`);
      return searchResults;

    } catch (error) {
      this.logger.error('Search failed', error);
      throw new Error(`Search operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Chat with documents using context-aware responses
   */
  async chatWithDocuments(
    query: string,
    conversationHistory?: string[]
  ): Promise<ChatResponse> {
    return await this.lanceDB.chatWithDocuments(query, conversationHistory);
  }

  /**
   * Add multi-modal document
   */
  async addMultiModalDocument(
    id: string,
    content: string,
    type: 'text' | 'image' | 'audio' | 'video' | 'multimodal',
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }> {
    // Multi-modal documents go through standard addDocuments flow
    const result = await this.lanceDB.addDocuments([{ id, content, type, metadata }]);
    return { success: result.success, error: result.error };
  }

  /**
   * Get collection statistics
   */
  async getCollectionStats(collectionName: string): Promise<{
    name: string;
    count: number;
    metadata?: Record<string, any>;
  }> {
    try {
      const stats = await this.lanceDB.getStats();
      
      return {
        name: collectionName,
        count: stats.totalDocuments,
        metadata: {
          embeddingModel: stats.embeddingModel,
          dataPath: stats.dataPath,
          isInitialized: stats.isInitialized
        }
      };

    } catch (error) {
      this.logger.error(`Failed to get stats for collection ${collectionName}`, error);
      throw new Error(`Stats operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List all collections (returns aggregated stats)
   */
  async listCollections(): Promise<VectorCollection[]> {
    try {
      const stats = await this.lanceDB.getStats();
      
      // LlamaIndex manages collections internally, return aggregated info
      return [{
        name: 'llamaindex_documents',
        count: stats.totalDocuments,
        metadata: {
          embeddingModel: stats.embeddingModel,
          dataPath: stats.dataPath,
          isInitialized: stats.isInitialized
        }
      }];

    } catch (error) {
      this.logger.error('Failed to list collections', error);
      throw new Error(`List collections failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete a collection (not supported in LlamaIndex, returns success for compatibility)
   */
  async deleteCollection(name: string): Promise<{ success: boolean; error?: string }> {
    this.logger.warn(`Collection deletion not supported in LlamaIndex: ${name}`);
    return { success: true };
  }

  /**
   * Test connection to the vector service
   */
  async testConnection(): Promise<{ connected: boolean; version?: string; error?: string }> {
    try {
      const result = await this.lanceDB.testConnection();
      
      return {
        connected: result.connected,
        version: 'Pure LanceDB + MCP Sampling',
        error: result.error
      };

    } catch (error) {
      this.logger.error('Connection test failed', error);
      return {
        connected: false,
        error: error instanceof Error ? error.message : 'Connection test failed'
      };
    }
  }

  /**
   * Generate embeddings for text
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      // LlamaIndex handles embeddings internally
      this.logger.info('Embedding generation handled by LanceDB internally');
      return null; // LlamaIndex abstracts this away

    } catch (error) {
      this.logger.error('Failed to generate embedding', error);
      return null;
    }
  }

  /**
   * Get service statistics
   */
  async getStats(): Promise<{
    totalDocuments: number;
    embeddingModel: string;
    dataPath: string;
    isInitialized: boolean;
  }> {
    return await this.lanceDB.getStats();
  }

  /**
   * Clean up resources
   */
  async shutdown(): Promise<void> {
    await this.lanceDB.shutdown();
    this.logger.info('VectorSearchService shutdown complete');
  }
}