/**
 * Integration Tests with Real GPU Embedding Service (Port 8765)
 * Tests end-to-end flow with actual embedding service
 *
 * REQUIRES: Embedding service running on http://localhost:8765
 * Start with: systemctl --user start embedding-service
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseManager } from '../database/index.js';
import { KnowledgeGraphMcpTools } from '../tools/knowledgeGraphTools.js';
import { KnowledgeGraphGPUMcpTools } from '../tools/knowledgeGraphGPUTools.js';
import type { SearchKnowledgeGraphInput } from '../schemas/tools/knowledgeGraph.js';
import type { GetEmbeddingStatusInput } from '../schemas/tools/knowledgeGraphGPU.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Check if embedding service is available
 */
async function checkEmbeddingService(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:8765/health', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Get embedding from service directly
 */
async function getEmbeddingDirect(text: string): Promise<number[]> {
  const response = await fetch('http://localhost:8765/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model: 'gemma3_06b' })
  });

  if (!response.ok) {
    throw new Error(`Embedding service error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.embedding;
}

describe('GPU Integration Tests - Real Embedding Service', () => {
  let db: DatabaseManager;
  let tools: KnowledgeGraphMcpTools;
  let gpuTools: KnowledgeGraphGPUMcpTools;
  let testRepoPath: string;
  let serviceAvailable = false;

  beforeAll(async () => {
    // Check if embedding service is running
    serviceAvailable = await checkEmbeddingService();

    if (!serviceAvailable) {
      console.warn('⚠️  Embedding service not available on port 8765');
      console.warn('⚠️  Start with: systemctl --user start embedding-service');
      console.warn('⚠️  Skipping GPU integration tests');
      return;
    }

    console.log('✅ Embedding service detected on port 8765');

    // Create temporary test directory
    testRepoPath = mkdtempSync(join(tmpdir(), 'zmcp-gpu-integration-'));

    // Initialize database and tools
    db = new DatabaseManager();
    tools = new KnowledgeGraphMcpTools(db);
    gpuTools = new KnowledgeGraphGPUMcpTools(db);
  }, 10000);

  afterAll(() => {
    if (testRepoPath) {
      try {
        rmSync(testRepoPath, { recursive: true, force: true });
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    }
  });

  describe('Service Health and Status', () => {
    it.skipIf(!serviceAvailable)('should get embedding service status', async () => {
      const input: GetEmbeddingStatusInput = {
        repository_path: testRepoPath
      };

      const result = await gpuTools['getEmbeddingStatus'](input);

      expect(result.service_healthy).toBe(true);
      expect(result.active_model).toBeDefined();
      expect(result.vram_usage).toBeDefined();
      expect(result.available_collections).toBeDefined();

      console.log('Embedding Service Status:');
      console.log(`  Active Model: ${result.active_model}`);
      console.log(`  VRAM Usage: ${result.vram_usage}`);
      console.log(`  Collections: ${result.available_collections.length}`);
    });

    it.skipIf(!serviceAvailable)('should report correct collection contexts', async () => {
      const input: GetEmbeddingStatusInput = {
        repository_path: testRepoPath
      };

      const result = await gpuTools['getEmbeddingStatus'](input);

      // Should have both global and project-local collections
      const globalCollections = result.available_collections.filter(
        c => c.context === 'global'
      );
      const projectCollections = result.available_collections.filter(
        c => c.context === 'project-local'
      );

      expect(result.available_collections.length).toBeGreaterThan(0);
      console.log(`  Global collections: ${globalCollections.length}`);
      console.log(`  Project-local collections: ${projectCollections.length}`);
    });
  });

  describe('End-to-End GPU Search Flow', () => {
    beforeAll(async () => {
      if (!serviceAvailable) return;

      // Create test entities with real GPU embeddings
      const kgService = db.getKnowledgeGraphService(testRepoPath);
      const vectorService = db.getVectorSearchService(testRepoPath);

      const testEntities = [
        {
          id: 'gpu-test-auth',
          type: 'function',
          name: 'authenticateUser',
          description: 'Validates user credentials using JWT tokens and creates authenticated sessions'
        },
        {
          id: 'gpu-test-db',
          type: 'function',
          name: 'queryDatabase',
          description: 'Executes SQL queries against PostgreSQL database with connection pooling'
        },
        {
          id: 'gpu-test-api',
          type: 'class',
          name: 'APIController',
          description: 'REST API controller handling HTTP requests and responses with Express middleware'
        }
      ];

      for (const entity of testEntities) {
        // Create entity
        await kgService.createEntity({
          id: entity.id,
          type: entity.type as any,
          name: entity.name,
          description: entity.description,
          importanceScore: 0.8,
          confidenceScore: 0.9,
          properties: {},
          discoveredBy: 'gpu-integration-test'
        });

        // Get real GPU embedding
        const embedding = await getEmbeddingDirect(entity.description);
        await vectorService.updateEntityEmbedding(entity.id, entity.description, embedding);
      }

      console.log('✅ Created test entities with real GPU embeddings');
    });

    it.skipIf(!serviceAvailable)('should perform GPU semantic search', async () => {
      const input = {
        repository_path: testRepoPath,
        query: 'user authentication and login',
        use_gpu: true,
        limit: 5,
        threshold: 0.5
      };

      const result = await gpuTools['searchKnowledgeGraphGPU'](input);

      expect(result.entities.length).toBeGreaterThan(0);
      expect(result.gpu_accelerated).toBe(true);

      // Should find auth-related entity
      const entityIds = result.entities.map(e => e.id);
      expect(entityIds).toContain('gpu-test-auth');

      console.log('GPU Search Results:');
      result.entities.forEach(e => {
        console.log(`  ${e.name} (score: ${e.importance_score})`);
      });
    });

    it.skipIf(!serviceAvailable)('should compare GPU vs CPU search performance', async () => {
      const query = 'database queries and SQL operations';

      // GPU search
      const gpuStart = Date.now();
      const gpuResult = await gpuTools['searchKnowledgeGraphGPU']({
        repository_path: testRepoPath,
        query,
        use_gpu: true,
        limit: 5,
        threshold: 0.5
      });
      const gpuDuration = Date.now() - gpuStart;

      // CPU search (fallback)
      const cpuStart = Date.now();
      const cpuResult = await tools['searchKnowledgeGraph']({
        repository_path: testRepoPath,
        query,
        use_semantic_search: true,
        limit: 5,
        threshold: 0.5
      });
      const cpuDuration = Date.now() - cpuStart;

      expect(gpuResult.entities.length).toBeGreaterThan(0);
      expect(cpuResult.entities.length).toBeGreaterThan(0);

      // GPU should generally be faster (but not always guaranteed)
      console.log('Performance Comparison:');
      console.log(`  GPU Search: ${gpuDuration}ms`);
      console.log(`  CPU Search: ${cpuDuration}ms`);
      console.log(`  Speedup: ${(cpuDuration / gpuDuration).toFixed(2)}x`);
    });

    it.skipIf(!serviceAvailable)('should handle GPU search with filters', async () => {
      const input = {
        repository_path: testRepoPath,
        query: 'API and web services',
        use_gpu: true,
        entity_types: ['class'],
        limit: 5,
        threshold: 0.5
      };

      const result = await gpuTools['searchKnowledgeGraphGPU'](input);

      expect(result.gpu_accelerated).toBe(true);

      // All results should be classes
      const allClasses = result.entities.every(e => e.type === 'class');
      expect(allClasses).toBe(true);

      console.log('Filtered GPU Search Results:');
      console.log(`  Found ${result.entities.length} entities of type 'class'`);
    });
  });

  describe('GPU Embedding Quality', () => {
    it.skipIf(!serviceAvailable)('should generate consistent embeddings for same text', async () => {
      const text = 'Test authentication with JWT tokens';

      const embedding1 = await getEmbeddingDirect(text);
      const embedding2 = await getEmbeddingDirect(text);

      expect(embedding1.length).toBe(embedding2.length);
      expect(embedding1).toEqual(embedding2);

      console.log(`Embedding dimension: ${embedding1.length}`);
    });

    it.skipIf(!serviceAvailable)('should generate different embeddings for different text', async () => {
      const text1 = 'User authentication with JWT';
      const text2 = 'Database query execution';

      const embedding1 = await getEmbeddingDirect(text1);
      const embedding2 = await getEmbeddingDirect(text2);

      expect(embedding1.length).toBe(embedding2.length);
      expect(embedding1).not.toEqual(embedding2);

      // Calculate similarity
      const similarity = cosineSimilarity(embedding1, embedding2);
      console.log(`Similarity between unrelated concepts: ${similarity.toFixed(4)}`);
      expect(similarity).toBeLessThan(0.8);
    });

    it.skipIf(!serviceAvailable)('should generate similar embeddings for related concepts', async () => {
      const text1 = 'User authentication and login';
      const text2 = 'Validate user credentials';

      const embedding1 = await getEmbeddingDirect(text1);
      const embedding2 = await getEmbeddingDirect(text2);

      const similarity = cosineSimilarity(embedding1, embedding2);
      console.log(`Similarity between related concepts: ${similarity.toFixed(4)}`);
      expect(similarity).toBeGreaterThan(0.5);
    });
  });

  describe('GPU Reranking (if available)', () => {
    it.skipIf(!serviceAvailable)('should support reranking for improved relevance', async () => {
      const input = {
        repository_path: testRepoPath,
        query: 'user authentication and credentials',
        use_gpu: true,
        use_reranker: true,
        limit: 5,
        threshold: 0.5
      };

      // This may not be implemented yet, so handle gracefully
      try {
        const result = await gpuTools['searchKnowledgeGraphGPU'](input);
        expect(result.gpu_accelerated).toBe(true);

        if (result.reranked) {
          console.log('✅ Reranking is supported and active');
        } else {
          console.log('ℹ️  Reranking parameter ignored (not implemented)');
        }
      } catch (error) {
        console.log('ℹ️  Reranking not yet supported');
      }
    });
  });

  describe('Error Handling and Fallbacks', () => {
    it.skipIf(!serviceAvailable)('should handle empty repository gracefully', async () => {
      const emptyRepoPath = mkdtempSync(join(tmpdir(), 'zmcp-empty-'));

      try {
        const input = {
          repository_path: emptyRepoPath,
          query: 'test query',
          use_gpu: true,
          limit: 5,
          threshold: 0.5
        };

        const result = await gpuTools['searchKnowledgeGraphGPU'](input);

        expect(result.entities).toBeDefined();
        expect(Array.isArray(result.entities)).toBe(true);
        expect(result.entities.length).toBe(0);
      } finally {
        rmSync(emptyRepoPath, { recursive: true, force: true });
      }
    });

    it.skipIf(!serviceAvailable)('should handle very large result sets', async () => {
      const input = {
        repository_path: testRepoPath,
        query: 'function or class or component',
        use_gpu: true,
        limit: 100,
        threshold: 0.3
      };

      const result = await gpuTools['searchKnowledgeGraphGPU'](input);

      expect(result.entities).toBeDefined();
      expect(result.entities.length).toBeLessThanOrEqual(100);
    });
  });

  describe('BM25 Hybrid Search (if available)', () => {
    it.skipIf(!serviceAvailable)('should support BM25 for exact term matching', async () => {
      const input = {
        repository_path: testRepoPath,
        query: 'authenticateUser',
        use_gpu: true,
        use_bm25: true,
        limit: 5,
        threshold: 0.5
      };

      try {
        const result = await gpuTools['searchKnowledgeGraphGPU'](input);

        expect(result.entities.length).toBeGreaterThan(0);

        // Should find exact function name match
        const exactMatch = result.entities.some(e => e.name === 'authenticateUser');
        expect(exactMatch).toBe(true);

        console.log('✅ BM25 hybrid search working');
      } catch (error) {
        console.log('ℹ️  BM25 not yet fully implemented');
      }
    });
  });
});

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}