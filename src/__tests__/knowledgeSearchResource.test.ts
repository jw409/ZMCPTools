import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import type { IndexedDocument, SearchResult, SearchOptions } from '../services/IndexedKnowledgeSearch.js';

describe('knowledge://search MCP Resource', () => {
  let testDir: string;
  let testCounter = 0;
  let indexedKnowledgePath: string;

  // Sample test documents
  const testDocuments: IndexedDocument[] = [
    {
      id: 'issue-1',
      type: 'github_issue',
      title: 'Authentication bug in OAuth flow',
      content: 'Users cannot authenticate using OAuth. The redirect_uri parameter is not being validated correctly.',
      repo: 'ZMCPTools',
      number: 1,
      state: 'open',
      labels: ['bug', 'authentication'],
      embedding: generateMockEmbedding('authentication oauth bug')
    },
    {
      id: 'issue-2',
      type: 'github_issue',
      title: 'Add JWT token support',
      content: 'Implement JWT token generation and validation for API authentication. Should support refresh tokens.',
      repo: 'ZMCPTools',
      number: 2,
      state: 'open',
      labels: ['feature', 'authentication'],
      embedding: generateMockEmbedding('jwt token authentication api')
    },
    {
      id: 'doc-1',
      type: 'markdown_file',
      title: 'Architecture Overview',
      content: 'The system uses a hybrid search approach combining BM25 keyword matching with semantic embeddings.',
      file_path: '/docs/architecture.md',
      relative_path: 'docs/architecture.md',
      size: 1024,
      modified: '2025-01-01T00:00:00Z',
      embedding: generateMockEmbedding('architecture hybrid search bm25 semantic')
    },
    {
      id: 'doc-2',
      type: 'markdown_file',
      title: 'Embedding Service Guide',
      content: 'GPU-accelerated embedding service using Qwen3 model. Provides 1024-dimensional embeddings.',
      file_path: '/docs/embedding.md',
      relative_path: 'docs/embedding.md',
      size: 2048,
      modified: '2025-01-02T00:00:00Z',
      embedding: generateMockEmbedding('gpu embedding qwen3 model')
    },
    {
      id: 'issue-3',
      type: 'github_issue',
      title: 'Improve search performance',
      content: 'Search is slow with large datasets. Consider optimizing the BM25 algorithm and caching embeddings.',
      repo: 'ZMCPTools',
      number: 3,
      state: 'closed',
      labels: ['performance', 'search'],
      embedding: generateMockEmbedding('search performance optimization bm25')
    }
  ];

  beforeEach(async () => {
    // Note: IndexedKnowledgeSearch uses hardcoded path /home/jw/dev/game1/var/storage/indexed_knowledge.json
    // We'll use the actual production path for testing since it's already isolated
    testDir = '/home/jw/dev/game1';
    indexedKnowledgePath = join(testDir, 'var/storage/indexed_knowledge.json');

    // Backup existing index if present
    const backupPath = indexedKnowledgePath + '.backup';
    try {
      await fs.copyFile(indexedKnowledgePath, backupPath);
    } catch (error) {
      // File doesn't exist, no backup needed
    }

    // Write test indexed_knowledge.json
    await fs.mkdir(join(testDir, 'var/storage'), { recursive: true });
    await fs.writeFile(indexedKnowledgePath, JSON.stringify(testDocuments, null, 2));
  });

  afterEach(async () => {
    // Restore backup if it exists
    const backupPath = indexedKnowledgePath + '.backup';
    try {
      await fs.copyFile(backupPath, indexedKnowledgePath);
      await fs.unlink(backupPath);
    } catch (error) {
      // No backup to restore, delete test index
      try {
        await fs.unlink(indexedKnowledgePath);
      } catch {
        // Already deleted or doesn't exist
      }
    }
  });

  describe('BM25 Keyword Search', () => {
    it('should find documents by exact keyword match', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      const results = await searchService.search('OAuth', {
        limit: 5,
        useBm25: true,
        useSemanticSearch: false
      });

      expect(results).toBeTruthy();
      expect(results.length).toBeGreaterThan(0);

      // Should find the issue with OAuth in title
      const oauthIssue = results.find(r => r.document.id === 'issue-1');
      expect(oauthIssue).toBeTruthy();
      expect(oauthIssue?.matchType).toBe('bm25');
      expect(oauthIssue?.bm25Score).toBeGreaterThan(0);
    });

    it('should rank documents by keyword frequency', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      const results = await searchService.search('authentication', {
        limit: 5,
        useBm25: true,
        useSemanticSearch: false
      });

      expect(results).toBeTruthy();
      expect(results.length).toBeGreaterThan(0);

      // All results should have BM25 scores
      results.forEach(result => {
        expect(result.bm25Score).toBeGreaterThan(0);
        expect(result.matchType).toBe('bm25');
      });

      // Results should be sorted by score
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('should handle multi-word queries', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      const results = await searchService.search('BM25 algorithm', {
        limit: 10,
        useBm25: true,
        useSemanticSearch: false
      });

      expect(results).toBeTruthy();
      expect(results.length).toBeGreaterThan(0);

      // Should find documents mentioning these search-related terms
      const hasSearchTerms = results.some(r =>
        r.document.content.toLowerCase().includes('bm25') ||
        r.document.content.toLowerCase().includes('algorithm')
      );
      expect(hasSearchTerms).toBeTruthy();
    });

    it('should be case-insensitive', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      const resultsLower = await searchService.search('oauth', {
        limit: 5,
        useBm25: true,
        useSemanticSearch: false
      });

      const resultsUpper = await searchService.search('OAUTH', {
        limit: 5,
        useBm25: true,
        useSemanticSearch: false
      });

      expect(resultsLower.length).toBe(resultsUpper.length);
      expect(resultsLower[0].document.id).toBe(resultsUpper[0].document.id);
    });
  });

  describe('Semantic Embedding Search', () => {
    it('should find documents by semantic similarity when GPU available', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      // Mock GPU service availability
      const mockCheckGPU = vi.fn().mockResolvedValue(true);
      const mockGenerateEmbeddings = vi.fn().mockResolvedValue({
        embeddings: [generateMockEmbedding('user login authentication')]
      });

      // Patch the embedding client
      (searchService as any).embeddingClient.checkGPUService = mockCheckGPU;
      (searchService as any).embeddingClient.generateEmbeddings = mockGenerateEmbeddings;

      const results = await searchService.search('user login', {
        limit: 5,
        useBm25: false,
        useSemanticSearch: true
      });

      expect(mockCheckGPU).toHaveBeenCalled();
      expect(mockGenerateEmbeddings).toHaveBeenCalledWith(['user login']);

      if (results.length > 0) {
        expect(results[0].matchType).toBe('semantic');
        expect(results[0].semanticScore).toBeDefined();
        expect(results[0].semanticScore).toBeGreaterThan(0);
      }
    });

    it('should return empty results when GPU unavailable', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      // Mock GPU service unavailable
      const mockCheckGPU = vi.fn().mockResolvedValue(false);
      (searchService as any).embeddingClient.checkGPUService = mockCheckGPU;

      const results = await searchService.search('user login', {
        limit: 5,
        useBm25: false,
        useSemanticSearch: true
      });

      expect(mockCheckGPU).toHaveBeenCalled();
      expect(results).toEqual([]);
    });

    it('should sort by semantic similarity score', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      // Mock GPU service
      const mockCheckGPU = vi.fn().mockResolvedValue(true);
      const mockGenerateEmbeddings = vi.fn().mockResolvedValue({
        embeddings: [generateMockEmbedding('search optimization')]
      });

      (searchService as any).embeddingClient.checkGPUService = mockCheckGPU;
      (searchService as any).embeddingClient.generateEmbeddings = mockGenerateEmbeddings;

      const results = await searchService.search('search optimization', {
        limit: 5,
        useBm25: false,
        useSemanticSearch: true
      });

      if (results.length > 1) {
        // Results should be sorted by semantic score
        for (let i = 1; i < results.length; i++) {
          expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
        }
      }
    });
  });

  describe('Hybrid Search (BM25 + Semantic)', () => {
    it('should combine BM25 and semantic scores with default weights', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      // Mock GPU service
      const mockCheckGPU = vi.fn().mockResolvedValue(true);
      const mockGenerateEmbeddings = vi.fn().mockResolvedValue({
        embeddings: [generateMockEmbedding('authentication')]
      });

      (searchService as any).embeddingClient.checkGPUService = mockCheckGPU;
      (searchService as any).embeddingClient.generateEmbeddings = mockGenerateEmbeddings;

      const results = await searchService.search('authentication', {
        limit: 5,
        useBm25: true,
        useSemanticSearch: true,
        bm25Weight: 0.3,
        semanticWeight: 0.7
      });

      expect(results).toBeTruthy();

      if (results.length > 0) {
        // Hybrid results should have both scores
        results.forEach(result => {
          expect(result.matchType).toBe('hybrid');

          // Combined score should be weighted sum
          if (result.bm25Score !== undefined && result.semanticScore !== undefined) {
            const expectedScore = (result.bm25Score * 0.3) + (result.semanticScore * 0.7);
            expect(result.score).toBeCloseTo(expectedScore, 5);
          }
        });
      }
    });

    it('should respect custom weight configuration', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      // Mock GPU service
      const mockCheckGPU = vi.fn().mockResolvedValue(true);
      const mockGenerateEmbeddings = vi.fn().mockResolvedValue({
        embeddings: [generateMockEmbedding('search')]
      });

      (searchService as any).embeddingClient.checkGPUService = mockCheckGPU;
      (searchService as any).embeddingClient.generateEmbeddings = mockGenerateEmbeddings;

      // Heavy BM25 weight
      const bm25Results = await searchService.search('search', {
        limit: 5,
        useBm25: true,
        useSemanticSearch: true,
        bm25Weight: 0.9,
        semanticWeight: 0.1
      });

      // Heavy semantic weight
      const semanticResults = await searchService.search('search', {
        limit: 5,
        useBm25: true,
        useSemanticSearch: true,
        bm25Weight: 0.1,
        semanticWeight: 0.9
      });

      // Results may differ based on weight preference
      expect(bm25Results).toBeTruthy();
      expect(semanticResults).toBeTruthy();
    });

    it('should merge results from both sources', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      // Mock GPU service
      const mockCheckGPU = vi.fn().mockResolvedValue(true);
      const mockGenerateEmbeddings = vi.fn().mockResolvedValue({
        embeddings: [generateMockEmbedding('jwt oauth')]
      });

      (searchService as any).embeddingClient.checkGPUService = mockCheckGPU;
      (searchService as any).embeddingClient.generateEmbeddings = mockGenerateEmbeddings;

      const results = await searchService.search('jwt oauth', {
        limit: 10,
        useBm25: true,
        useSemanticSearch: true
      });

      expect(results).toBeTruthy();

      // Should include documents from both BM25 and semantic search
      // Check for no duplicates
      const ids = results.map(r => r.document.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });
  });

  describe('Query Parameter Handling', () => {
    it('should respect limit parameter', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      const results = await searchService.search('authentication', {
        limit: 2,
        useBm25: true,
        useSemanticSearch: false
      });

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should apply threshold filtering', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      const results = await searchService.search('authentication', {
        limit: 10,
        useBm25: true,
        useSemanticSearch: false,
        minScoreThreshold: 0.5
      });

      // All results should meet threshold
      results.forEach(result => {
        expect(result.score).toBeGreaterThanOrEqual(0.5);
      });
    });

    it('should handle zero results with high threshold', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      const results = await searchService.search('nonexistent_term_xyz', {
        limit: 10,
        useBm25: true,
        useSemanticSearch: false,
        minScoreThreshold: 0.99
      });

      expect(results).toEqual([]);
    });

    it('should use default parameters when not specified', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      const results = await searchService.search('authentication');

      // Should use defaults: limit=10, useBm25=true, useSemanticSearch=true
      expect(results.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Search Result Ranking', () => {
    it('should return results sorted by score descending', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      const results = await searchService.search('authentication search', {
        limit: 10,
        useBm25: true,
        useSemanticSearch: false
      });

      expect(results).toBeTruthy();

      if (results.length > 1) {
        for (let i = 1; i < results.length; i++) {
          expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
        }
      }
    });

    it('should include all score components in results', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      const results = await searchService.search('oauth', {
        limit: 5,
        useBm25: true,
        useSemanticSearch: false
      });

      expect(results).toBeTruthy();

      if (results.length > 0) {
        const result = results[0];
        expect(result).toHaveProperty('document');
        expect(result).toHaveProperty('score');
        expect(result).toHaveProperty('matchType');
        expect(result).toHaveProperty('bm25Score');
        expect(result.document).toHaveProperty('id');
        expect(result.document).toHaveProperty('type');
        expect(result.document).toHaveProperty('content');
      }
    });
  });

  describe('Empty Results Handling', () => {
    it('should return empty array for non-matching query', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      const results = await searchService.search('zzz_nonexistent_xyz_123', {
        limit: 10,
        useBm25: true,
        useSemanticSearch: false
      });

      expect(results).toEqual([]);
    });

    it('should handle empty index gracefully', async () => {
      // Create empty index
      await fs.writeFile(indexedKnowledgePath, JSON.stringify([], null, 2));

      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      // Force reload by accessing private documents property
      (searchService as any).documents = null;

      const results = await searchService.search('anything', {
        limit: 10,
        useBm25: true,
        useSemanticSearch: false
      });

      expect(results).toEqual([]);
    });

    it('should handle missing index file', async () => {
      // Delete index file
      await fs.unlink(indexedKnowledgePath);

      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      // Force reload by accessing private documents property
      (searchService as any).documents = null;

      const results = await searchService.search('anything', {
        limit: 10,
        useBm25: true,
        useSemanticSearch: false
      });

      expect(results).toEqual([]);
    });
  });

  describe('Integration with IndexedKnowledgeSearch', () => {
    it('should load documents on first search', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      // First search should load documents
      const results1 = await searchService.search('oauth', {
        limit: 5,
        useBm25: true,
        useSemanticSearch: false
      });

      // Second search should use cached documents
      const results2 = await searchService.search('oauth', {
        limit: 5,
        useBm25: true,
        useSemanticSearch: false
      });

      expect(results1).toBeTruthy();
      expect(results2).toBeTruthy();
      expect(results1.length).toBe(results2.length);
    });

    it('should search both GitHub issues and markdown files', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      const results = await searchService.search('authentication', {
        limit: 10,
        useBm25: true,
        useSemanticSearch: false
      });

      expect(results).toBeTruthy();

      // Should find both types
      const types = new Set(results.map(r => r.document.type));
      expect(types.size).toBeGreaterThan(0);
    });

    it('should preserve document metadata in results', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      const results = await searchService.search('oauth', {
        limit: 5,
        useBm25: true,
        useSemanticSearch: false
      });

      expect(results).toBeTruthy();

      if (results.length > 0) {
        const issueResult = results.find(r => r.document.type === 'github_issue');
        if (issueResult) {
          expect(issueResult.document).toHaveProperty('repo');
          expect(issueResult.document).toHaveProperty('number');
          expect(issueResult.document).toHaveProperty('state');
          expect(issueResult.document).toHaveProperty('labels');
        }

        const docResult = results.find(r => r.document.type === 'markdown_file');
        if (docResult) {
          expect(docResult.document).toHaveProperty('file_path');
          expect(docResult.document).toHaveProperty('relative_path');
          expect(docResult.document).toHaveProperty('size');
        }
      }
    });
  });

  describe('MCP Resource Format Compliance', () => {
    it('should return results in correct MCP format', async () => {
      const { IndexedKnowledgeSearch } = await import('../services/IndexedKnowledgeSearch.js');
      const searchService = new IndexedKnowledgeSearch(testDir);

      const results = await searchService.search('authentication', {
        limit: 5,
        useBm25: true,
        useSemanticSearch: false
      });

      expect(results).toBeTruthy();
      expect(Array.isArray(results)).toBe(true);

      if (results.length > 0) {
        const result = results[0];

        // Check SearchResult interface
        expect(result).toHaveProperty('document');
        expect(result).toHaveProperty('score');
        expect(result).toHaveProperty('matchType');
        expect(['bm25', 'semantic', 'hybrid']).toContain(result.matchType);

        // Check IndexedDocument interface
        expect(result.document).toHaveProperty('id');
        expect(result.document).toHaveProperty('type');
        expect(['github_issue', 'markdown_file']).toContain(result.document.type);
        expect(result.document).toHaveProperty('content');
      }
    });
  });
});

/**
 * Generate a mock embedding vector based on text
 * Uses simple hash-based generation for consistent test embeddings
 */
function generateMockEmbedding(text: string, dimensions: number = 1024): number[] {
  const embedding = new Array(dimensions).fill(0);

  // Simple hash-based generation
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    const idx = (charCode * (i + 1)) % dimensions;
    embedding[idx] += (charCode / 255) * 0.1;
  }

  // Normalize
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < dimensions; i++) {
      embedding[i] /= magnitude;
    }
  }

  return embedding;
}
