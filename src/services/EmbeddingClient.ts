/**
 * EmbeddingClient Service
 * Stateless GPU embedding generation with per-request model selection
 * Both qwen3 and gemma3 are available simultaneously on GPU service
 */

import { Logger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { StoragePathResolver } from './StoragePathResolver.js';

export interface EmbeddingConfig {
  default_model: 'gemma3' | 'qwen3';
  gpu_endpoint: string;
}

export interface CollectionMetadata {
  model: string;
  dimensions: number;
  created_at: string;
  vector_count: number;
  last_indexed: string | null;
  locked: boolean;
  fingerprint: string;
  gpu_service_version?: string;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  default_model: string;
  gpu_available: boolean;
  available_models: Array<{
    name: string;
    dimensions: number;
    collection_exists: boolean;
    vector_count: number;
  }>;
  warnings: string[];
  last_validation: string;
}

export interface EmbeddingResult {
  embeddings: number[][];
  dimensions: number;
  model: string;
  fingerprint: string;
}

export interface ModelInfo {
  name: string;
  dimensions: number;
  requires_gpu: boolean;
  api_model_name: string;
  collection_suffix: string;
}

export class EmbeddingClient {
  private logger: Logger;
  private configPath: string;
  private config: EmbeddingConfig;
  private mcptoolsDir: string;

  // Model specifications - both available simultaneously on GPU service
  private readonly MODEL_SPECS: Record<string, ModelInfo> = {
    qwen3: {
      name: 'Qwen3-Embedding-4B',
      dimensions: 2560,
      requires_gpu: true,
      api_model_name: 'qwen3_4b',
      collection_suffix: 'qwen3'
    },
    gemma3: {
      name: 'EmbeddingGemma-300M',
      dimensions: 768,
      requires_gpu: true,
      api_model_name: 'gemma_embed',
      collection_suffix: 'gemma3'
    }
  };

  private readonly DEFAULT_CONFIG: EmbeddingConfig = {
    default_model: 'qwen3',
    gpu_endpoint: 'http://localhost:8765'
  };

  constructor() {
    this.logger = new Logger('embedding-client');
    this.mcptoolsDir = path.join(homedir(), '.mcptools');

    // Use StoragePathResolver for project-local isolation
    const storageConfig = StoragePathResolver.getStorageConfig({ preferLocal: true });
    const basePath = StoragePathResolver.getBaseStoragePath(storageConfig);
    this.configPath = path.join(basePath, 'embedding_config.json');

    // Ensure storage directories exist
    StoragePathResolver.ensureStorageDirectories(storageConfig);

    this.config = this.loadConfig();
  }

  /**
   * Load embedding configuration from disk
   */
  private loadConfig(): EmbeddingConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        const parsedConfig = JSON.parse(configData);

        // Merge with defaults to handle config migration
        return {
          ...this.DEFAULT_CONFIG,
          ...parsedConfig,
          // Migrate old active_model to default_model
          default_model: parsedConfig.default_model || parsedConfig.active_model || 'qwen3'
        };
      } else {
        // Create default config file
        this.saveConfig(this.DEFAULT_CONFIG);
        return this.DEFAULT_CONFIG;
      }
    } catch (error) {
      this.logger.error('Failed to load embedding config, using defaults', { error });
      return this.DEFAULT_CONFIG;
    }
  }

  /**
   * Save embedding configuration to disk
   */
  private saveConfig(config: EmbeddingConfig): void {
    try {
      // Ensure directory exists
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
      this.logger.debug('Embedding config saved', { configPath: this.configPath });
    } catch (error) {
      this.logger.error('Failed to save embedding config', { error, configPath: this.configPath });
    }
  }

  /**
   * Get or create collection metadata file
   */
  private getCollectionMetadataPath(collectionName: string): string {
    const lancedbDir = path.join(this.mcptoolsDir, 'lancedb');
    return path.join(lancedbDir, `${collectionName}.metadata.json`);
  }

  /**
   * Load collection metadata
   */
  private loadCollectionMetadata(collectionName: string): CollectionMetadata | null {
    try {
      const metadataPath = this.getCollectionMetadataPath(collectionName);
      if (!fs.existsSync(metadataPath)) {
        return null;
      }

      const metadataData = fs.readFileSync(metadataPath, 'utf8');
      return JSON.parse(metadataData);
    } catch (error) {
      this.logger.error('Failed to load collection metadata', { collectionName, error });
      return null;
    }
  }

  /**
   * Save collection metadata
   */
  private saveCollectionMetadata(collectionName: string, metadata: CollectionMetadata): void {
    try {
      const metadataPath = this.getCollectionMetadataPath(collectionName);
      const metadataDir = path.dirname(metadataPath);

      if (!fs.existsSync(metadataDir)) {
        fs.mkdirSync(metadataDir, { recursive: true });
      }

      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      this.logger.debug('Collection metadata saved', { collectionName, metadataPath });
    } catch (error) {
      this.logger.error('Failed to save collection metadata', { collectionName, error });
    }
  }

  /**
   * Validate collection compatibility with specified model
   */
  async validateCollection(collectionName: string, model: 'gemma3' | 'qwen3'): Promise<CollectionMetadata> {
    const metadata = this.loadCollectionMetadata(collectionName);

    if (!metadata) {
      throw new Error(`Collection '${collectionName}' does not exist`);
    }

    const modelInfo = this.MODEL_SPECS[model];

    // Check dimension compatibility
    if (metadata.dimensions !== modelInfo.dimensions) {
      throw new Error(
        `Dimension mismatch! Collection '${collectionName}' uses ${metadata.dimensions} dimensions ` +
        `but model '${model}' uses ${modelInfo.dimensions} dimensions. ` +
        `These are incompatible vector spaces.`
      );
    }

    // Check model compatibility
    if (metadata.model !== model) {
      throw new Error(
        `Model mismatch! Collection '${collectionName}' was indexed with '${metadata.model}' ` +
        `but you specified model '${model}'. Use the correct collection or model.`
      );
    }

    this.logger.debug('Collection validation passed', {
      collectionName,
      model: metadata.model,
      dimensions: metadata.dimensions,
      vectors: metadata.vector_count
    });

    return metadata;
  }

  /**
   * Check if GPU embedding service is available
   */
  async checkGPUService(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.gpu_endpoint}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      });

      if (!response.ok) return false;

      const health = await response.json();
      return health.status === 'healthy';
    } catch (error) {
      this.logger.debug('GPU service check failed', { error: error.message });
      return false;
    }
  }

  /**
   * Get comprehensive health status
   */
  async getHealthStatus(): Promise<HealthStatus> {
    const warnings: string[] = [];

    // Check GPU availability
    const gpuAvailable = await this.checkGPUService();
    if (!gpuAvailable) {
      warnings.push('GPU service unavailable - both qwen3 and gemma3 require GPU');
    }

    // Check all available models and their collections
    const available_models = Object.entries(this.MODEL_SPECS).map(([mode, modelInfo]) => {
      const collectionName = `knowledge_graph_${modelInfo.collection_suffix}`;
      const metadata = this.loadCollectionMetadata(collectionName);

      return {
        name: mode,
        dimensions: modelInfo.dimensions,
        collection_exists: metadata !== null,
        vector_count: metadata?.vector_count || 0
      };
    });

    // Determine overall status
    let status: HealthStatus['status'] = 'healthy';
    if (warnings.length > 0) {
      status = 'degraded';
    }
    if (!gpuAvailable) {
      status = 'unhealthy';
    }

    return {
      status,
      default_model: this.config.default_model,
      gpu_available: gpuAvailable,
      available_models,
      warnings,
      last_validation: new Date().toISOString()
    };
  }

  /**
   * Set default model preference (optional - both models always available)
   */
  setDefaultModel(model: 'gemma3' | 'qwen3'): void {
    this.config.default_model = model;
    this.saveConfig(this.config);
    this.logger.info('Default model updated', { default_model: model });
  }

  /**
   * Get current embedding configuration
   */
  getConfig(): EmbeddingConfig {
    return { ...this.config };
  }

  /**
   * Get model information by name
   */
  getModelInfo(model: 'gemma3' | 'qwen3'): ModelInfo {
    return this.MODEL_SPECS[model];
  }

  /**
   * Get collection name for specified model
   */
  getCollectionName(baseName: string, model: 'gemma3' | 'qwen3'): string {
    const modelInfo = this.MODEL_SPECS[model];
    return `${baseName}_${modelInfo.collection_suffix}`;
  }

  /**
   * Create fingerprint for specified model
   */
  createFingerprint(model: 'gemma3' | 'qwen3'): string {
    const modelInfo = this.MODEL_SPECS[model];
    return `${model}_${modelInfo.dimensions}_v1`;
  }

  /**
   * Generate embeddings with request-time model selection
   * @param texts - Array of texts to embed
   * @param options - Embedding options
   * @param options.model - Model to use (defaults to config.default_model)
   * @param options.isQuery - Whether these are query texts (true) or document texts (false)
   */
  async generateEmbeddings(
    texts: string[],
    options: { model?: 'gemma3' | 'qwen3'; isQuery?: boolean } = {}
  ): Promise<EmbeddingResult> {
    const model = options.model || this.config.default_model;
    const isQuery = options.isQuery || false;
    const modelInfo = this.MODEL_SPECS[model];

    // Validate GPU availability
    if (!(await this.checkGPUService())) {
      throw new Error(`GPU service unavailable - cannot generate ${modelInfo.name} embeddings`);
    }

    return this.generateGPUEmbeddings(texts, modelInfo, model, isQuery);
  }

  /**
   * Generate embeddings using GPU service (Gemma3 or Qwen3)
   */
  private async generateGPUEmbeddings(
    texts: string[],
    modelInfo: ModelInfo,
    model: 'gemma3' | 'qwen3',
    isQuery: boolean = false
  ): Promise<EmbeddingResult> {
    try {
      const response = await fetch(`${this.config.gpu_endpoint}/embed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          texts: texts,
          model: modelInfo.api_model_name,
          is_query: isQuery  // Let service apply task-specific prompts
        })
      });

      if (!response.ok) {
        throw new Error(`GPU embedding service error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      // Validate dimensions
      if (result.dimensions !== modelInfo.dimensions) {
        throw new Error(
          `Dimension validation failed! Expected ${modelInfo.dimensions}, got ${result.dimensions}`
        );
      }

      this.logger.debug('Generated GPU embeddings', {
        model: modelInfo.name,
        texts_count: texts.length,
        dimensions: result.dimensions
      });

      return {
        embeddings: result.embeddings,
        dimensions: result.dimensions,
        model: modelInfo.name,
        fingerprint: this.createFingerprint(model)
      };
    } catch (error) {
      this.logger.error('Failed to generate GPU embeddings', {
        model: modelInfo.name,
        error: error.message,
        texts_count: texts.length
      });
      throw error;
    }
  }


  /**
   * Rerank documents using Qwen3-4B reranker for quality boost
   * Local GPU is superfast - quality is more important than speed
   * @param query - The search query
   * @param documents - Array of document texts to rerank
   * @param topK - Number of top results to return (default: all documents)
   * @param model - Reranker model to use (default: 'qwen3_reranker')
   * @returns Array of reranked results with scores
   */
  async rerank(
    query: string,
    documents: string[],
    topK?: number,
    model: 'qwen3_reranker' | 'reranker' = 'qwen3_reranker'
  ): Promise<Array<{
    document: string;
    score: number;
    original_index: number;
    rank: number;
  }>> {
    try {
      // Check GPU service availability
      if (!(await this.checkGPUService())) {
        this.logger.warn('GPU service unavailable - reranking skipped, returning original order');
        // Return documents in original order with placeholder scores
        return documents.map((doc, index) => ({
          document: doc,
          score: 1.0 - (index * 0.01), // Decreasing scores
          original_index: index,
          rank: index + 1
        }));
      }

      const response = await fetch(`${this.config.gpu_endpoint}/rerank`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query,
          documents,
          top_k: topK || documents.length,
          model
        })
      });

      if (!response.ok) {
        throw new Error(`Reranking service error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      this.logger.debug('Documents reranked successfully', {
        query: query.substring(0, 50),
        input_count: documents.length,
        output_count: result.results.length,
        model: result.model
      });

      return result.results;
    } catch (error) {
      this.logger.error('Failed to rerank documents', {
        query: query.substring(0, 50),
        document_count: documents.length,
        error: error.message
      });
      // Return documents in original order on error
      return documents.map((doc, index) => ({
        document: doc,
        score: 1.0 - (index * 0.01),
        original_index: index,
        rank: index + 1
      }));
    }
  }
}
