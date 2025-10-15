/**
 * Smart Embedding Queue with Adaptive Batching
 *
 * Buffers embedding requests and sends them in optimally-sized batches
 * to prevent overwhelming the GPU service. Provides backpressure, retry logic,
 * and adaptive batch sizing based on service performance.
 *
 * Features:
 * - Request coalescing: Accumulate multiple requests into single HTTP call
 * - Adaptive batching: Adjust batch size based on service latency
 * - Backpressure: Block new requests when queue is full
 * - Retry logic: Exponential backoff for transient failures
 * - Observability: Metrics and stats for debugging
 */

import { Logger } from '../utils/logger.js';

const logger = new Logger('embedding-queue');

interface PendingRequest {
  text: string;
  metadata?: any;
  resolve: (embedding: number[] | null) => void;
  reject: (error: Error) => void;
}

interface QueueStats {
  queueDepth: number;
  inflightRequests: number;
  totalProcessed: number;
  totalFailed: number;
  failureRate: number;
  avgBatchSize: number;
  avgLatency: number;
  currentBatchSize: number;
}

interface QueueConfig {
  minBatchSize: number;
  maxBatchSize: number;
  initialBatchSize: number;
  flushInterval: number;
  maxConcurrent: number;
  retryAttempts: number;
  retryDelays: number[];
  targetLatency: number;
  serviceUrl: string;
  model: string;
}

export class EmbeddingQueue {
  private pendingRequests: PendingRequest[] = [];
  private inflightCount: number = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private config: QueueConfig;

  // Metrics
  private totalProcessed: number = 0;
  private totalFailed: number = 0;
  private latencyHistory: number[] = [];
  private batchSizeHistory: number[] = [];
  private currentBatchSize: number;

  constructor(config?: Partial<QueueConfig>) {
    this.config = {
      minBatchSize: 50,
      maxBatchSize: 150,
      initialBatchSize: 100,
      flushInterval: 500, // ms
      maxConcurrent: 3,
      retryAttempts: 3,
      retryDelays: [100, 500, 2000], // ms
      targetLatency: 3000, // ms
      serviceUrl: 'http://localhost:8765/embed',
      model: 'qwen3_4b',
      ...config
    };

    this.currentBatchSize = this.config.initialBatchSize;
  }

  /**
   * Add a text for embedding
   * Returns promise that resolves when embedding is ready
   * Blocks if queue is full (backpressure)
   */
  async add(text: string, metadata?: any): Promise<number[] | null> {
    // Backpressure: wait if too many inflight requests
    await this.waitForCapacity();

    return new Promise<number[] | null>((resolve, reject) => {
      this.pendingRequests.push({ text, metadata, resolve, reject });

      // Start flush timer if not already running
      if (!this.flushTimer) {
        this.scheduleFlush();
      }

      // Flush immediately if batch is full
      if (this.pendingRequests.length >= this.currentBatchSize) {
        this.flush();
      }
    });
  }

  /**
   * Add multiple texts at once
   */
  async addBatch(texts: string[], metadata?: any[]): Promise<(number[] | null)[]> {
    return Promise.all(
      texts.map((text, i) => this.add(text, metadata?.[i]))
    );
  }

  /**
   * Wait for queue capacity (backpressure mechanism)
   */
  private async waitForCapacity(): Promise<void> {
    while (this.inflightCount >= this.config.maxConcurrent) {
      logger.debug('Queue full, waiting for capacity...', {
        inflight: this.inflightCount,
        maxConcurrent: this.config.maxConcurrent
      });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Schedule a flush after the configured interval
   */
  private scheduleFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    this.flushTimer = setTimeout(() => {
      this.flush();
    }, this.config.flushInterval);
  }

  /**
   * Flush pending requests immediately
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.pendingRequests.length === 0) {
      return;
    }

    // Take batch from queue
    const batch = this.pendingRequests.splice(0, this.currentBatchSize);
    this.inflightCount++;

    const startTime = Date.now();
    logger.info(`Flushing batch of ${batch.length} requests`, {
      queueDepth: this.pendingRequests.length,
      inflight: this.inflightCount,
      batchSize: this.currentBatchSize
    });

    try {
      // Send batch to service with retry
      const embeddings = await this.sendBatchWithRetry(
        batch.map(r => r.text)
      );

      const latency = Date.now() - startTime;
      this.recordMetrics(batch.length, latency, 0);

      // Resolve all promises
      batch.forEach((request, i) => {
        request.resolve(embeddings[i]);
      });

      logger.info(`Batch completed successfully`, {
        batchSize: batch.length,
        latency,
        queueDepth: this.pendingRequests.length
      });

      // Adjust batch size based on latency
      this.adaptBatchSize(latency);

    } catch (error: any) {
      logger.error('Batch failed after retries', {
        batchSize: batch.length,
        error: error.message
      });

      this.recordMetrics(batch.length, Date.now() - startTime, batch.length);

      // Reject all promises
      batch.forEach(request => {
        request.reject(error);
      });
    } finally {
      this.inflightCount--;

      // Continue flushing if more requests pending
      if (this.pendingRequests.length > 0) {
        this.scheduleFlush();
      }
    }
  }

  /**
   * Send batch with exponential backoff retry
   */
  private async sendBatchWithRetry(texts: string[]): Promise<(number[] | null)[]> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const response = await fetch(this.config.serviceUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            texts,
            model: this.config.model
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        return result.embeddings || texts.map(() => null);

      } catch (error: any) {
        lastError = error;

        if (attempt < this.config.retryAttempts) {
          const delay = this.config.retryDelays[attempt] || 2000;
          logger.warn(`Batch failed, retrying in ${delay}ms`, {
            attempt: attempt + 1,
            maxAttempts: this.config.retryAttempts,
            error: error.message
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Batch failed after all retries');
  }

  /**
   * Adapt batch size based on service latency
   */
  private adaptBatchSize(latency: number): void {
    const { minBatchSize, maxBatchSize, targetLatency } = this.config;

    if (latency > targetLatency * 1.5) {
      // Service is slow, reduce batch size
      this.currentBatchSize = Math.max(
        minBatchSize,
        Math.floor(this.currentBatchSize * 0.8)
      );
      logger.info('Reducing batch size due to high latency', {
        latency,
        newBatchSize: this.currentBatchSize
      });
    } else if (latency < targetLatency * 0.5) {
      // Service is fast, increase batch size
      this.currentBatchSize = Math.min(
        maxBatchSize,
        Math.floor(this.currentBatchSize * 1.2)
      );
      logger.info('Increasing batch size due to low latency', {
        latency,
        newBatchSize: this.currentBatchSize
      });
    }
  }

  /**
   * Record metrics for observability
   */
  private recordMetrics(batchSize: number, latency: number, failures: number): void {
    this.totalProcessed += batchSize;
    this.totalFailed += failures;

    this.latencyHistory.push(latency);
    if (this.latencyHistory.length > 10) {
      this.latencyHistory.shift();
    }

    this.batchSizeHistory.push(batchSize);
    if (this.batchSizeHistory.length > 10) {
      this.batchSizeHistory.shift();
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const avgLatency = this.latencyHistory.length > 0
      ? this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length
      : 0;

    const avgBatchSize = this.batchSizeHistory.length > 0
      ? this.batchSizeHistory.reduce((a, b) => a + b, 0) / this.batchSizeHistory.length
      : 0;

    const failureRate = this.totalProcessed > 0
      ? this.totalFailed / this.totalProcessed
      : 0;

    return {
      queueDepth: this.pendingRequests.length,
      inflightRequests: this.inflightCount,
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed,
      failureRate,
      avgBatchSize,
      avgLatency,
      currentBatchSize: this.currentBatchSize
    };
  }

  /**
   * Reset queue (for testing)
   */
  reset(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingRequests = [];
    this.inflightCount = 0;
    this.totalProcessed = 0;
    this.totalFailed = 0;
    this.latencyHistory = [];
    this.batchSizeHistory = [];
    this.currentBatchSize = this.config.initialBatchSize;
  }
}

// Singleton instance
let globalQueue: EmbeddingQueue | null = null;

/**
 * Get or create the global embedding queue
 */
export function getEmbeddingQueue(config?: Partial<QueueConfig>): EmbeddingQueue {
  if (!globalQueue) {
    globalQueue = new EmbeddingQueue(config);
  }
  return globalQueue;
}
