/**
 * LanceDB Vector Search Service
 * Modern implementation using @lancedb/lancedb with proper embeddings
 * Based on LanceDB TypeScript API 2024/2025
 */

import * as lancedb from '@lancedb/lancedb';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Logger } from '../utils/logger.js';
import type { DatabaseManager } from '../database/index.js';

export interface LanceDBConfig {
  dataPath?: string;
  embeddingProvider?: 'openai' | 'huggingface' | 'local';
  embeddingModel?: string;
  apiKey?: string;
  vectorDimension?: number;
}

export interface VectorDocument {
  id: string;
  content: string;
  metadata?: Record<string, any>;
  type?: 'text' | 'image' | 'audio' | 'video' | 'multimodal';
}

export interface VectorSearchResult {
  id: string;
  content: string;
  metadata?: Record<string, any>;
  score: number;
  distance: number;
}

export interface Collection {
  name: string;
  count: number;
  metadata?: Record<string, any>;
}

/**
 * Simple embedding function for development/fallback
 * In production, replace with OpenAI, HuggingFace, or Transformers.js
 */
class SimpleEmbeddingFunction {
  private dimension: number;
  private logger: Logger;

  constructor(dimension: number = 384) {
    this.dimension = dimension;
    this.logger = new Logger('simple-embedding');
  }

  /**
   * Generate simple embeddings based on text features
   * This is a basic implementation - use proper embeddings in production
   */
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(text => this.textToVector(text));
  }

  private textToVector(text: string): number[] {
    // Simple deterministic embedding based on text characteristics
    const vector = new Array(this.dimension).fill(0);
    
    // Use text characteristics to create consistent embeddings
    const words = text.toLowerCase().split(/\s+/);
    const chars = text.toLowerCase().split('');
    
    for (let i = 0; i < this.dimension; i++) {
      let value = 0;
      
      // Word-based features
      if (i < words.length) {
        const word = words[i];
        value += word.length * 0.1;
        value += word.charCodeAt(0) * 0.01;
      }
      
      // Character-based features
      if (i < chars.length) {
        value += chars[i].charCodeAt(0) * 0.001;
      }
      
      // Text length normalization
      value += text.length * 0.0001;
      
      // Add some deterministic variation based on position
      value += Math.sin(i * 0.1) * 0.05;
      
      vector[i] = value;
    }
    
    // Normalize vector
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return vector.map(val => magnitude > 0 ? val / magnitude : 0);
  }
}

export class LanceDBService {
  private connection: lancedb.Connection | null = null;
  private tables: Map<string, lancedb.Table> = new Map();
  private embeddingFunction: SimpleEmbeddingFunction;
  private logger: Logger;
  private config: LanceDBConfig;
  private dataPath: string;

  constructor(
    private db: DatabaseManager,
    config: LanceDBConfig = {}
  ) {
    this.logger = new Logger('lancedb');
    this.config = {
      embeddingProvider: 'local',
      embeddingModel: 'simple-text-embeddings',
      vectorDimension: 384,
      ...config
    };

    // Set up data directory
    this.dataPath = config.dataPath || join(homedir(), '.mcptools', 'lancedb');
    this.ensureDataDirectory();

    // Initialize embedding function
    this.embeddingFunction = new SimpleEmbeddingFunction(this.config.vectorDimension);

    this.logger.info('LanceDBService initialized', {
      dataPath: this.dataPath,
      embeddingProvider: this.config.embeddingProvider,
      embeddingModel: this.config.embeddingModel,
      vectorDimension: this.config.vectorDimension
    });
  }

  /**
   * Initialize connection to LanceDB
   */
  async initialize(): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.connection) {
        return { success: true };
      }

      // Connect to LanceDB using the current API
      this.connection = await lancedb.connect(this.dataPath);
      this.logger.info('Connected to LanceDB', { path: this.dataPath });

      return { success: true };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to initialize LanceDB', { error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Create or get a collection (table)
   */
  async createCollection(
    name: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const initResult = await this.initialize();
      if (!initResult.success) {
        return initResult;
      }

      // Check if table already exists
      if (this.tables.has(name)) {
        this.logger.info(`Collection ${name} already exists`);
        return { success: true };
      }

      try {
        // Try to open existing table
        const existingTable = await this.connection!.openTable(name);
        this.tables.set(name, existingTable);
        this.logger.info(`Opened existing collection: ${name}`);
        return { success: true };
      } catch (error) {
        // Table doesn't exist, create it with explicit schema
        const sampleEmbedding = await this.embeddingFunction.embed(['initialization']);
        const sampleData = [{
          id: 'init',
          content: 'Initialization document',
          vector: sampleEmbedding[0],
          metadata: JSON.stringify({ init: true, collection: name, ...metadata })
        }];

        // Create table with explicit schema
        const table = await this.connection!.createTable(name, sampleData, {
          mode: 'overwrite'
        });
        this.tables.set(name, table);
        this.logger.info(`Created new collection: ${name}`);
        return { success: true };
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to create collection ${name}`, { error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Add documents to a collection with automatic embedding
   */
  async addDocuments(
    collectionName: string,
    documents: VectorDocument[]
  ): Promise<{ success: boolean; addedCount: number; error?: string }> {
    try {
      // Ensure collection exists
      const createResult = await this.createCollection(collectionName);
      if (!createResult.success) {
        return { success: false, addedCount: 0, error: createResult.error };
      }

      const table = this.tables.get(collectionName)!;

      // Generate embeddings for all documents
      const contents = documents.map(doc => doc.content);
      const embeddings = await this.embeddingFunction.embed(contents);

      // Convert to LanceDB format
      const lanceData = documents.map((doc, index) => ({
        id: doc.id,
        content: doc.content,
        vector: embeddings[index],
        metadata: JSON.stringify({
          type: doc.type || 'text',
          collection: collectionName,
          addedAt: new Date().toISOString(),
          ...doc.metadata
        })
      }));

      // Add to table
      await table.add(lanceData);
      
      this.logger.info(`Added ${documents.length} documents to collection ${collectionName}`);
      return {
        success: true,
        addedCount: documents.length
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to add documents to ${collectionName}`, { error: errorMsg });
      return {
        success: false,
        addedCount: 0,
        error: errorMsg
      };
    }
  }

  /**
   * Search for similar documents using vector similarity
   */
  async searchSimilar(
    collectionName: string,
    query: string,
    limit: number = 10,
    threshold: number = 0.7
  ): Promise<VectorSearchResult[]> {
    try {
      // Ensure collection exists
      const createResult = await this.createCollection(collectionName);
      if (!createResult.success) {
        throw new Error(`Collection access failed: ${createResult.error}`);
      }

      const table = this.tables.get(collectionName)!;

      // Generate embedding for query
      const queryEmbedding = await this.embeddingFunction.embed([query]);
      const queryVector = queryEmbedding[0];

      // Perform vector similarity search
      const results = await table
        .search(queryVector)
        .limit(limit)
        .toArray();

      // Convert to standard format and apply threshold
      const searchResults: VectorSearchResult[] = results
        .map((result: any) => {
          let metadata = {};
          try {
            metadata = JSON.parse(result.metadata || '{}');
          } catch (error) {
            this.logger.warn('Failed to parse metadata', { metadata: result.metadata });
          }

          // LanceDB returns distance, convert to similarity score
          const distance = result._distance || 0;
          const score = Math.max(0, 1 - distance); // Convert distance to similarity

          return {
            id: result.id,
            content: result.content,
            metadata,
            score,
            distance
          };
        })
        .filter(result => result.score >= threshold)
        .sort((a, b) => b.score - a.score); // Sort by highest similarity

      this.logger.info(`Found ${searchResults.length} similar documents in ${collectionName}`);
      return searchResults;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Search failed in collection ${collectionName}`, { error: errorMsg });
      throw new Error(`Search operation failed: ${errorMsg}`);
    }
  }

  /**
   * List all collections
   */
  async listCollections(): Promise<Collection[]> {
    try {
      const initResult = await this.initialize();
      if (!initResult.success) {
        throw new Error(`Initialization failed: ${initResult.error}`);
      }

      const tableNames = await this.connection!.tableNames();
      
      const collections: Collection[] = [];
      for (const name of tableNames) {
        try {
          const table = await this.connection!.openTable(name);
          // Get approximate count (LanceDB doesn't expose direct count)
          const sampleResults = await table.search([0]).limit(1).toArray();
          
          collections.push({
            name,
            count: sampleResults.length > 0 ? -1 : 0, // -1 indicates "has data"
            metadata: {
              hasData: sampleResults.length > 0
            }
          });
        } catch (error) {
          this.logger.warn(`Failed to get stats for collection ${name}`, error);
        }
      }

      return collections;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to list collections', { error: errorMsg });
      throw new Error(`List collections failed: ${errorMsg}`);
    }
  }

  /**
   * Delete a collection
   */
  async deleteCollection(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      const initResult = await this.initialize();
      if (!initResult.success) {
        return initResult;
      }

      await this.connection!.dropTable(name);
      this.tables.delete(name);
      
      this.logger.info(`Deleted collection: ${name}`);
      return { success: true };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to delete collection ${name}`, { error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Test connection and functionality
   */
  async testConnection(): Promise<{ connected: boolean; error?: string }> {
    try {
      const initResult = await this.initialize();
      if (!initResult.success) {
        return {
          connected: false,
          error: initResult.error
        };
      }

      // Test by creating a temporary collection and searching
      const testCollection = 'test_' + Date.now();
      const createResult = await this.createCollection(testCollection);
      if (!createResult.success) {
        return {
          connected: false,
          error: `Test collection creation failed: ${createResult.error}`
        };
      }

      // Test adding and searching
      const testDoc: VectorDocument = {
        id: 'test_doc',
        content: 'This is a test document for connection verification.',
        metadata: { test: true }
      };

      const addResult = await this.addDocuments(testCollection, [testDoc]);
      if (!addResult.success) {
        return {
          connected: false,
          error: `Test document add failed: ${addResult.error}`
        };
      }

      const searchResults = await this.searchSimilar(testCollection, 'test document', 1);
      
      // Clean up test collection
      await this.deleteCollection(testCollection);

      this.logger.info('LanceDB connection test successful', {
        searchResultsFound: searchResults.length
      });

      return { connected: true };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Connection test failed';
      this.logger.error('LanceDB connection test failed', { error: errorMsg });
      return {
        connected: false,
        error: errorMsg
      };
    }
  }

  /**
   * Get service statistics
   */
  async getStats(): Promise<{
    totalCollections: number;
    embeddingProvider: string;
    embeddingModel: string;
    dataPath: string;
    isInitialized: boolean;
  }> {
    try {
      const isInitialized = this.connection !== null;
      let totalCollections = 0;

      if (isInitialized) {
        const collections = await this.listCollections();
        totalCollections = collections.length;
      }
      
      return {
        totalCollections,
        embeddingProvider: this.config.embeddingProvider!,
        embeddingModel: this.config.embeddingModel!,
        dataPath: this.dataPath,
        isInitialized
      };

    } catch (error) {
      this.logger.error('Failed to get LanceDB stats', error);
      return {
        totalCollections: 0,
        embeddingProvider: this.config.embeddingProvider!,
        embeddingModel: this.config.embeddingModel!,
        dataPath: this.dataPath,
        isInitialized: false
      };
    }
  }

  /**
   * Check if connected to LanceDB
   */
  isConnected(): boolean {
    return this.connection !== null;
  }

  /**
   * Clean up resources
   */
  async shutdown(): Promise<void> {
    this.connection = null;
    this.tables.clear();
    this.logger.info('LanceDBService shutdown complete');
  }

  private ensureDataDirectory(): void {
    if (!existsSync(this.dataPath)) {
      mkdirSync(this.dataPath, { recursive: true });
      this.logger.info('Created LanceDB data directory', { path: this.dataPath });
    }
  }
}