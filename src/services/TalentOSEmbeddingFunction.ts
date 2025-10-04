/**
 * TalentOS Embedding Function
 * Integrates with TalentOS GPU embedding service (port 8765) for high-performance embeddings
 * Supports Qwen3 0.6B (1024D) and other GPU-accelerated models
 */

import { Logger } from '../utils/logger.js';
import { EmbeddingClient } from './EmbeddingClient.js';

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
  private isAvailable: boolean = false;
  private lastHealthCheck: number = 0;
  private healthCheckInterval: number = 30000; // 30 seconds
  private cache = new Map<string, number[]>();
  private maxCacheSize = 1000;

  constructor(config: TalentOSEmbeddingConfig = {}) {
    this.logger = new Logger('talentos-embedding');
    this.embeddingClient = new EmbeddingClient();

    this.config = {
      modelName: config.modelName || 'gemma_embed', // Default to EmbeddingGemma-300M (768D)
      endpoint: config.endpoint || 'http://localhost:8765',
      timeout: config.timeout || 30000,
      batchSize: config.batchSize || 50,
      fallbackModel: config.fallbackModel || 'Xenova/all-MiniLM-L6-v2'
    };

    this.logger.info('TalentOS embedding function initialized', {
      model: this.config.modelName,
      endpoint: this.config.endpoint,
      dimensions: this.getDimension()
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
   */
  private async embedBatch(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];

    for (const text of texts) {
      // Check cache first
      if (this.cache.has(text)) {
        embeddings.push(this.cache.get(text)!);
        continue;
      }

      try {
        const embedding = await this.generateSingleEmbedding(text);

        // Cache the result
        if (this.cache.size >= this.maxCacheSize) {
          const oldestKey = this.cache.keys().next().value;
          this.cache.delete(oldestKey);
        }
        this.cache.set(text, embedding);

        embeddings.push(embedding);

      } catch (error) {
        this.logger.error('Failed to generate embedding for text', {
          text: text.substring(0, 100),
          error: error.message
        });

        // Create a fallback embedding to prevent complete failure
        const fallbackEmbedding = this.createFallbackEmbedding(text);
        embeddings.push(fallbackEmbedding);
      }
    }

    return embeddings;
  }

  /**
   * Generate embedding for a single text using TalentOS API
   */
  private async generateSingleEmbedding(text: string): Promise<number[]> {
    const requestBody = {
      text: text,
      model: this.config.modelName
    };

    const response = await fetch(`${this.config.endpoint}/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(this.config.timeout)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`TalentOS embedding request failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    if (!result.embedding || !Array.isArray(result.embedding)) {
      throw new Error('Invalid embedding response from TalentOS service');
    }

    return result.embedding;
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
        return 1024; // Qwen3 4B dimensions
      case 'qwen3_8b':
        return 1024; // Qwen3 8B dimensions
      case 'gemma_embed':
        return 768;  // Gemma embedding dimensions
      case 'minilm':
        return 384;  // MiniLM dimensions
      default:
        this.logger.warn('Unknown model dimensions, defaulting to 1024', { model: this.config.modelName });
        return 1024; // Default to Qwen3 dimensions
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