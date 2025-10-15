/**
 * TalentOS Embedding Function
 * Integrates with TalentOS GPU embedding service (port 8765) for high-performance embeddings
 * Supports Qwen3 0.6B (1024D) and other GPU-accelerated models
 */

import { Logger } from '../utils/logger.js';
import { EmbeddingClient } from './EmbeddingClient.js';
import { getEmbeddingQueue } from './EmbeddingQueue.js';

export interface TalentOSEmbeddingConfig {
  modelName?: string;
  endpoint?: string;
  timeout?: number;
  batchSize?: number;
  fallbackModel?: string;
}

/**
 * TalentOS-compatible embedding function for LanceDB
 * Uses TalentOS GPU embedding service for high-performance vector generation
 */
export class TalentOSEmbeddingFunction {
  private logger: Logger;
  private config: Required<TalentOSEmbeddingConfig>;
  private embeddingClient: EmbeddingClient;
  private embeddingQueue: ReturnType<typeof getEmbeddingQueue>;
  private isAvailable: boolean = false;
  private lastHealthCheck: number = 0;
  private healthCheckInterval: number = 30000; // 30 seconds
  private cache = new Map<string, number[]>();
  private maxCacheSize = 1000;

  constructor(config: TalentOSEmbeddingConfig = {}) {
    this.logger = new Logger('talentos-embedding');
    this.embeddingClient = new EmbeddingClient();

    this.config = {
      modelName: config.modelName || 'qwen3_4b', // Default to Qwen3-Embedding-4B (2560D)
      endpoint: config.endpoint || 'http://localhost:8765',
      timeout: config.timeout || 30000,
      batchSize: config.batchSize || 50,
      fallbackModel: config.fallbackModel || 'Xenova/all-MiniLM-L6-v2'
    };

    // Initialize smart embedding queue with adaptive batching
    this.embeddingQueue = getEmbeddingQueue({
      serviceUrl: `${this.config.endpoint}/embed`,
      model: this.config.modelName,
      initialBatchSize: this.config.batchSize,
      maxBatchSize: 150,
      minBatchSize: 30,
      flushInterval: 500,
      maxConcurrent: 3,
      targetLatency: 3000
    });

    this.logger.info('TalentOS embedding function initialized with smart queue', {
      model: this.config.modelName,
      endpoint: this.config.endpoint,
      dimensions: this.getDimension(),
      queueConfig: {
        initialBatchSize: this.config.batchSize,
        maxConcurrent: 3
      }
    });
  }

  /**
   * Check if TalentOS GPU service is available
   */
  async checkAvailability(): Promise<boolean> {
    const now = Date.now();

    // Use cached result if recent
    if (now - this.lastHealthCheck < this.healthCheckInterval) {
      return this.isAvailable;
    }

    try {
      const response = await fetch(`${this.config.endpoint}/health`, {
        signal: AbortSignal.timeout(5000) // Quick health check
      });

      if (!response.ok) {
        this.isAvailable = false;
        this.logger.warn('TalentOS service health check failed', { status: response.status });
        return false;
      }

      const health = await response.json();
      this.isAvailable = health.status === 'healthy';
      this.lastHealthCheck = now;

      if (this.isAvailable) {
        // Check if our desired model is available
        const modelsAvailable = health.models_available || [];
        if (!modelsAvailable.includes(this.config.modelName)) {
          this.logger.warn('Desired model not available on TalentOS service', {
            desired: this.config.modelName,
            available: modelsAvailable
          });
          // Still mark as available but will need to handle model loading
        }

        this.logger.debug('TalentOS service is healthy', {
          device: health.device,
          vram_free_gb: health.vram_free_gb,
          models_loaded: health.models_loaded
        });
      }

      return this.isAvailable;

    } catch (error) {
      this.isAvailable = false;
      this.lastHealthCheck = now;
      this.logger.debug('TalentOS service unavailable', { error: error.message });
      return false;
    }
  }

  /**
   * Generate embeddings using TalentOS GPU service
   */
  async embed(texts: string[]): Promise<number[][]> {
    // Check service availability
    const available = await this.checkAvailability();
    if (!available) {
      throw new Error('TalentOS embedding service unavailable - service not healthy or not responding');
    }

    const embeddings: number[][] = [];

    // Process in batches for efficiency
    for (let i = 0; i < texts.length; i += this.config.batchSize) {
      const batch = texts.slice(i, i + this.config.batchSize);
      const batchEmbeddings = await this.embedBatch(batch);
      embeddings.push(...batchEmbeddings);
    }

    return embeddings;
  }

  /**
   * Process a batch of texts for embedding
   * OPTIMIZED: Send all uncached texts in ONE batch request to keep GPU saturated
   */
  private async embedBatch(texts: string[]): Promise<number[][]> {
    // Separate cached vs uncached texts
    const uncachedTexts: string[] = [];
    const uncachedIndices: number[] = [];
    const results: (number[] | null)[] = new Array(texts.length).fill(null);

    // Extract cached embeddings and identify uncached texts
    texts.forEach((text, idx) => {
      if (this.cache.has(text)) {
        results[idx] = this.cache.get(text)!;
      } else {
        uncachedTexts.push(text);
        uncachedIndices.push(idx);
      }
    });

    // If all texts were cached, return immediately
    if (uncachedTexts.length === 0) {
      return results as number[][];
    }

    try {
      // Generate embeddings for ALL uncached texts in ONE batch request
      const newEmbeddings = await this.generateBatchEmbeddings(uncachedTexts);

      // Merge new embeddings into results and update cache
      newEmbeddings.forEach((embedding, i) => {
        const originalIdx = uncachedIndices[i];
        const text = uncachedTexts[i];

        results[originalIdx] = embedding;

        // Update cache (evict oldest if full)
        if (this.cache.size >= this.maxCacheSize) {
          const oldestKey = this.cache.keys().next().value;
          this.cache.delete(oldestKey);
        }
        this.cache.set(text, embedding);
      });

      return results as number[][];

    } catch (error) {
      this.logger.error('Failed to generate batch embeddings - CRITICAL ERROR', {
        batchSize: uncachedTexts.length,
        error: error.message,
        stack: error.stack
      });

      // DO NOT use fallback - fail loudly so we can debug
      throw new Error(`TalentOS batch embedding generation failed: ${error.message}`);
    }
  }

  /**
   * Generate embeddings for multiple texts using smart embedding queue
   * Queue handles batching, backpressure, retry logic, and adaptive sizing
   */
  private async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    this.logger.debug(`Queueing ${texts.length} texts for embedding`, {
      queueStats: this.embeddingQueue.getStats()
    });

    // Send all texts to the queue - it will handle batching and backpressure
    const embeddings = await this.embeddingQueue.addBatch(texts);

    // Filter out nulls (failed embeddings) and use fallback
    const results = embeddings.map((embedding, i) => {
      if (embedding === null) {
        this.logger.warn(`Embedding failed for text ${i}, using fallback`);
        return this.createFallbackEmbedding(texts[i]);
      }
      return embedding;
    });

    return results;
  }

  /**
   * Get the embedding dimension for the configured model
   */
  getDimension(): number {
    // Return dimensions based on TalentOS models
    switch (this.config.modelName) {
      case 'qwen3_06b':
        return 1024; // Qwen3 0.6B dimensions
      case 'qwen3_4b':
        return 2560; // Qwen3 4B dimensions (CORRECT: 2560, not 1024!)
      case 'qwen3_8b':
        return 4096; // Qwen3 8B dimensions
      case 'gemma_embed':
        return 768;  // Gemma embedding dimensions
      case 'minilm':
        return 384;  // MiniLM dimensions
      default:
        this.logger.warn('Unknown model dimensions, defaulting to 2560', { model: this.config.modelName });
        return 2560; // Default to Qwen3-4B dimensions
    }
  }

  /**
   * Create a deterministic fallback embedding when GPU service fails
   */
  private createFallbackEmbedding(text: string): number[] {
    const dimension = this.getDimension();
    const vector = new Array(dimension).fill(0);

    // Create a simple but deterministic embedding based on text characteristics
    const words = text.toLowerCase().split(/\s+/);
    const chars = text.toLowerCase().split('');

    for (let i = 0; i < dimension; i++) {
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

      // Text-level features
      value += text.length * 0.0001;
      value += Math.sin(i * 0.1) * 0.05;

      // Normalize to [-1, 1] range
      vector[i] = Math.tanh(value);
    }

    // Normalize the vector
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= magnitude;
      }
    }

    this.logger.warn('Used fallback embedding generation', {
      textLength: text.length,
      dimension: dimension
    });

    return vector;
  }

  /**
   * Get TalentOS service status and model information
   */
  async getServiceStatus(): Promise<{
    available: boolean;
    model: string;
    dimensions: number;
    endpoint: string;
    health?: any;
  }> {
    const available = await this.checkAvailability();
    let health = null;

    if (available) {
      try {
        const response = await fetch(`${this.config.endpoint}/health`);
        if (response.ok) {
          health = await response.json();
        }
      } catch (error) {
        this.logger.debug('Could not fetch detailed health status', { error: error.message });
      }
    }

    return {
      available,
      model: this.config.modelName,
      dimensions: this.getDimension(),
      endpoint: this.config.endpoint,
      health
    };
  }

  /**
   * Switch to a different model (if available on TalentOS service)
   */
  async switchModel(modelName: string): Promise<boolean> {
    try {
      const available = await this.checkAvailability();
      if (!available) {
        return false;
      }

      // Get available models
      const response = await fetch(`${this.config.endpoint}/models`);
      if (!response.ok) {
        return false;
      }

      const models = await response.json();
      if (!models.models_available?.includes(modelName)) {
        this.logger.warn('Model not available for switching', {
          requested: modelName,
          available: models.models_available
        });
        return false;
      }

      // Clear cache since we're switching models
      this.cache.clear();

      // Update configuration
      this.config.modelName = modelName;

      this.logger.info('Switched TalentOS embedding model', {
        newModel: modelName,
        dimensions: this.getDimension()
      });

      return true;

    } catch (error) {
      this.logger.error('Failed to switch model', { modelName, error: error.message });
      return false;
    }
  }

  /**
   * Clear the embedding cache
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.info('Embedding cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number; hitRate?: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize
    };
  }
}