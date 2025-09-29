/**
 * EmbeddingClient Service
 * Provides GPU-first embedding generation with coarse-grained mode switching
 * Strong validation and safety checks to prevent silent failures and re-index loops
 */

import { Logger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

export interface EmbeddingConfig {
  active_model: 'gemma3' | 'qwen3' | 'minilm';
  gpu_endpoint: string;
  auto_fallback: boolean;
  reindex_cooldown_hours: number;
  last_indexed: {
    gemma3: string | null;
    qwen3: string | null;
    minilm: string | null;
  };
  reindex_count: {
    gemma3: number;
    qwen3: number;
    minilm: number;
  };
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
  active_model: string;
  dimensions: number;
  gpu_available: boolean;
  collections: Record<string, {
    exists: boolean;
    vectors: number;
    compatible: boolean;
    last_indexed: string | null;
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

  // Model specifications
  private readonly MODEL_SPECS: Record<string, ModelInfo> = {
    gemma3: {
      name: 'EmbeddingGemma-300M',
      dimensions: 768,
      requires_gpu: true,
      api_model_name: 'gemma_embed',
      collection_suffix: 'gemma3'
    },
    qwen3: {
      name: 'Qwen3-Embedding-0.6B',
      dimensions: 1024,
      requires_gpu: true,
      api_model_name: 'qwen3_06b',
      collection_suffix: 'qwen3'
    },
    minilm: {
      name: 'MiniLM-L6-v2',
      dimensions: 384,
      requires_gpu: false,
      api_model_name: 'minilm',
      collection_suffix: 'minilm'
    }
  };

  private readonly DEFAULT_CONFIG: EmbeddingConfig = {
    active_model: 'qwen3',
    gpu_endpoint: 'http://localhost:8765',
    auto_fallback: false,
    reindex_cooldown_hours: 24,
    last_indexed: {
      gemma3: null,
      qwen3: null,
      minilm: null
    },
    reindex_count: {
      gemma3: 0,
      qwen3: 0,
      minilm: 0
    }
  };

  constructor() {
    this.logger = new Logger('embedding-client');
    this.mcptoolsDir = path.join(homedir(), '.mcptools');
    this.configPath = path.join(this.mcptoolsDir, 'embedding_config.json');
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

        // Merge with defaults to handle new config fields
        return {
          ...this.DEFAULT_CONFIG,
          ...parsedConfig,
          last_indexed: {
            ...this.DEFAULT_CONFIG.last_indexed,
            ...parsedConfig.last_indexed
          },
          reindex_count: {
            ...this.DEFAULT_CONFIG.reindex_count,
            ...parsedConfig.reindex_count
          }
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
   * Validate collection compatibility with current model
   */
  async validateCollection(collectionName: string): Promise<CollectionMetadata> {
    const metadata = this.loadCollectionMetadata(collectionName);

    if (!metadata) {
      throw new Error(`Collection '${collectionName}' does not exist`);
    }

    const currentModel = this.getActiveModelInfo();

    // Check dimension compatibility
    if (metadata.dimensions !== currentModel.dimensions) {
      throw new Error(
        `Dimension mismatch! Collection '${collectionName}' uses ${metadata.dimensions} dimensions ` +
        `but active model '${this.config.active_model}' uses ${currentModel.dimensions} dimensions. ` +
        `These are incompatible vector spaces.`
      );
    }

    // Check model compatibility
    if (metadata.model !== this.config.active_model) {
      throw new Error(
        `Model mismatch! Collection '${collectionName}' was indexed with '${metadata.model}' ` +
        `but active model is '${this.config.active_model}'. Switch model or collection.`
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
    const currentModel = this.getActiveModelInfo();

    // Check GPU availability
    const gpuAvailable = await this.checkGPUService();
    if (currentModel.requires_gpu && !gpuAvailable) {
      warnings.push(`GPU required for ${currentModel.name} but GPU service unavailable`);
    }

    // Check collections
    const collections: HealthStatus['collections'] = {};

    for (const [mode, modelInfo] of Object.entries(this.MODEL_SPECS)) {
      const collectionName = `knowledge_graph_${modelInfo.collection_suffix}`;
      const metadata = this.loadCollectionMetadata(collectionName);

      collections[collectionName] = {
        exists: metadata !== null,
        vectors: metadata?.vector_count || 0,
        compatible: metadata ? metadata.model === this.config.active_model : false,
        last_indexed: metadata?.last_indexed || null
      };
    }

    // Determine overall status
    let status: HealthStatus['status'] = 'healthy';
    if (warnings.length > 0) {
      status = 'degraded';
    }
    if (currentModel.requires_gpu && !gpuAvailable) {
      status = 'unhealthy';
    }

    return {
      status,
      active_model: this.config.active_model,
      dimensions: currentModel.dimensions,
      gpu_available: gpuAvailable,
      collections,
      warnings,
      last_validation: new Date().toISOString()
    };
  }

  /**
   * Switch embedding mode with safety checks
   */
  async switchMode(mode: 'gemma3' | 'qwen3' | 'minilm', options: { force?: boolean } = {}): Promise<void> {
    const modelInfo = this.MODEL_SPECS[mode];
    const currentCollectionName = this.getCollectionName('knowledge_graph');
    const currentMetadata = this.loadCollectionMetadata(currentCollectionName);

    this.logger.info('Attempting to switch embedding mode', {
      from: this.config.active_model,
      to: mode,
      dimensions: modelInfo.dimensions,
      requires_gpu: modelInfo.requires_gpu,
      force: options.force
    });

    // Check if we have vectors in current collection
    if (currentMetadata && currentMetadata.vector_count > 0 && !options.force) {
      throw new Error(
        `Cannot switch to ${mode}: Current collection '${currentCollectionName}' has ${currentMetadata.vector_count} vectors. ` +
        `Switching would make these vectors unsearchable. Use --force to proceed (will require re-indexing).`
      );
    }

    // Check cooldown period
    const lastReindex = this.config.last_indexed[this.config.active_model];
    if (lastReindex && !options.force) {
      const hoursSinceReindex = (Date.now() - new Date(lastReindex).getTime()) / (1000 * 60 * 60);
      if (hoursSinceReindex < this.config.reindex_cooldown_hours) {
        throw new Error(
          `Cannot switch: Last re-index was ${hoursSinceReindex.toFixed(1)} hours ago. ` +
          `Cooldown period: ${this.config.reindex_cooldown_hours} hours. Use --force to override.`
        );
      }
    }

    // Validate GPU availability for GPU-required models
    if (modelInfo.requires_gpu && !(await this.checkGPUService())) {
      throw new Error(`GPU service unavailable - cannot switch to ${mode} (requires GPU)`);
    }

    // Update configuration
    this.config.active_model = mode;
    this.saveConfig(this.config);

    this.logger.info('Embedding mode switched successfully', {
      active_model: mode,
      collection_suffix: modelInfo.collection_suffix,
      dimensions: modelInfo.dimensions,
      requires_reindex: currentMetadata?.vector_count > 0
    });
  }

  /**
   * Get current embedding configuration
   */
  getConfig(): EmbeddingConfig {
    return { ...this.config };
  }

  /**
   * Get current active model information
   */
  getActiveModelInfo(): ModelInfo {
    return this.MODEL_SPECS[this.config.active_model];
  }

  /**
   * Get collection name for current active model
   */
  getCollectionName(baseName: string): string {
    const modelInfo = this.getActiveModelInfo();
    return `${baseName}_${modelInfo.collection_suffix}`;
  }

  /**
   * Create fingerprint for current model
   */
  createFingerprint(): string {
    const modelInfo = this.getActiveModelInfo();
    return `${this.config.active_model}_${modelInfo.dimensions}_v1`;
  }

  /**
   * Generate embeddings using current active model
   */
  async generateEmbeddings(texts: string[]): Promise<EmbeddingResult> {
    const modelInfo = this.getActiveModelInfo();

    // Validate model availability
    if (modelInfo.requires_gpu && !(await this.checkGPUService())) {
      throw new Error(`GPU service unavailable - cannot generate ${modelInfo.name} embeddings`);
    }

    if (modelInfo.requires_gpu) {
      return this.generateGPUEmbeddings(texts, modelInfo);
    } else {
      return this.generateCPUEmbeddings(texts, modelInfo);
    }
  }

  /**
   * Generate embeddings using GPU service (Gemma3 or Qwen3)
   */
  private async generateGPUEmbeddings(texts: string[], modelInfo: ModelInfo): Promise<EmbeddingResult> {
    try {
      const response = await fetch(`${this.config.gpu_endpoint}/embed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          texts: texts,
          model: modelInfo.api_model_name
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
        fingerprint: this.createFingerprint()
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
   * Generate embeddings using CPU (MiniLM only)
   */
  private async generateCPUEmbeddings(texts: string[], modelInfo: ModelInfo): Promise<EmbeddingResult> {
    // For now, throw an error - CPU implementation would require additional setup
    throw new Error('CPU embedding generation not yet implemented - use GPU mode or switch to GPU-capable model');
  }

  /**
   * Update reindex timestamp and count
   */
  updateReindexStats(): void {
    this.config.last_indexed[this.config.active_model] = new Date().toISOString();
    this.config.reindex_count[this.config.active_model]++;
    this.saveConfig(this.config);
  }

  /**
   * Get embedding statistics for current mode
   */
  getEmbeddingStats(): {
    model: string;
    dimensions: number;
    requires_gpu: boolean;
    last_indexed: string | null;
    reindex_count: number;
    cooldown_remaining_hours: number;
  } {
    const modelInfo = this.getActiveModelInfo();
    const lastIndexed = this.config.last_indexed[this.config.active_model];

    let cooldownRemaining = 0;
    if (lastIndexed) {
      const hoursSinceReindex = (Date.now() - new Date(lastIndexed).getTime()) / (1000 * 60 * 60);
      cooldownRemaining = Math.max(0, this.config.reindex_cooldown_hours - hoursSinceReindex);
    }

    return {
      model: modelInfo.name,
      dimensions: modelInfo.dimensions,
      requires_gpu: modelInfo.requires_gpu,
      last_indexed: lastIndexed,
      reindex_count: this.config.reindex_count[this.config.active_model],
      cooldown_remaining_hours: cooldownRemaining
    };
  }

  /**
   * List all available embedding modes with their status
   */
  getAvailableModes(): Array<{
    mode: string;
    info: ModelInfo;
    active: boolean;
    collection_exists: boolean;
    vector_count: number;
  }> {
    return Object.entries(this.MODEL_SPECS).map(([mode, info]) => {
      const collectionName = `knowledge_graph_${info.collection_suffix}`;
      const metadata = this.loadCollectionMetadata(collectionName);

      return {
        mode,
        info,
        active: mode === this.config.active_model,
        collection_exists: metadata !== null,
        vector_count: metadata?.vector_count || 0
      };
    });
  }
}