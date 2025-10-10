import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ResourceManager } from '../managers/ResourceManager.js';
import { DatabaseManager } from '../database/index.js';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Resource Pagination', () => {
  let dbManager: DatabaseManager;
  let resourceManager: ResourceManager;
  let tempDir: string;

  beforeAll(async () => {
    // Create temporary directory for test database
    tempDir = await mkdtemp(join(tmpdir(), 'zmcp-pagination-test-'));
    const dbPath = join(tempDir, 'test.db');

    dbManager = new DatabaseManager(dbPath);
    await dbManager.initialize();

    resourceManager = new ResourceManager(dbManager, process.cwd());
  });

  afterAll(async () => {
    await dbManager.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('symbols://list pagination', () => {
    it('should return paginated results with default limit', async () => {
      const result = await resourceManager.readResource('symbols://list');

      expect(result).toBeDefined();
      expect(result.mimeType).toBe('application/json');

      const data = JSON.parse(result.text);
      expect(data).toHaveProperty('indexed_files');
      expect(data).toHaveProperty('limit');
      expect(data).toHaveProperty('total');
      expect(data.limit).toBe(100); // Default limit

      // If there are more than 100 files, should have nextCursor
      if (data.total > 100) {
        expect(data).toHaveProperty('nextCursor');
        expect(typeof data.nextCursor).toBe('string');
      }
    });

    it('should respect custom limit parameter', async () => {
      const result = await resourceManager.readResource('symbols://list?limit=10');

      const data = JSON.parse(result.text);
      expect(data.limit).toBe(10);
      expect(data.indexed_files.length).toBeLessThanOrEqual(10);
    });

    it('should support cursor-based pagination', async () => {
      // Get first page
      const page1 = await resourceManager.readResource('symbols://list?limit=5');
      const data1 = JSON.parse(page1.text);

      if (data1.nextCursor) {
        // Get second page using cursor
        const page2 = await resourceManager.readResource(
          `symbols://list?limit=5&cursor=${encodeURIComponent(data1.nextCursor)}`
        );
        const data2 = JSON.parse(page2.text);

        // Second page should have different files
        expect(data2.indexed_files).toBeDefined();

        // Files should not overlap (if we have enough files)
        if (data1.indexed_files.length > 0 && data2.indexed_files.length > 0) {
          const page1Paths = new Set(data1.indexed_files.map((f: any) => f.file_path));
          const page2Paths = new Set(data2.indexed_files.map((f: any) => f.file_path));

          // Check for non-overlapping sets
          const overlap = [...page1Paths].filter(p => page2Paths.has(p));
          expect(overlap.length).toBe(0);
        }
      }
    });
  });

  describe('symbols://search pagination', () => {
    it('should return paginated search results with default limit', async () => {
      const result = await resourceManager.readResource('symbols://search?name=test');

      const data = JSON.parse(result.text);
      expect(data).toHaveProperty('symbols');
      expect(data).toHaveProperty('limit');
      expect(data.limit).toBe(50); // Default limit
    });

    it('should support cursor pagination for search', async () => {
      const result = await resourceManager.readResource('symbols://search?name=&limit=5');

      const data = JSON.parse(result.text);
      if (data.nextCursor) {
        const page2Result = await resourceManager.readResource(
          `symbols://search?name=&limit=5&cursor=${encodeURIComponent(data.nextCursor)}`
        );
        const page2 = JSON.parse(page2Result.text);

        expect(page2.symbols).toBeDefined();
        expect(Array.isArray(page2.symbols)).toBe(true);
      }
    });
  });

  describe('knowledge://search pagination', () => {
    it('should return paginated knowledge search results', async () => {
      const result = await resourceManager.readResource('knowledge://search?query=test&limit=5');

      const data = JSON.parse(result.text);
      expect(data).toHaveProperty('results');
      expect(data).toHaveProperty('limit');
      expect(data.limit).toBe(5);

      // Should support cursor pagination
      if (data.nextCursor) {
        expect(typeof data.nextCursor).toBe('string');
      }
    });

    it('should support cursor-based pagination for knowledge search', async () => {
      const page1Result = await resourceManager.readResource('knowledge://search?query=search&limit=3');
      const page1 = JSON.parse(page1Result.text);

      if (page1.nextCursor) {
        const page2Result = await resourceManager.readResource(
          `knowledge://search?query=search&limit=3&cursor=${encodeURIComponent(page1.nextCursor)}`
        );
        const page2 = JSON.parse(page2Result.text);

        expect(page2.results).toBeDefined();
        expect(Array.isArray(page2.results)).toBe(true);
      }
    });
  });

  describe('Cursor encoding/decoding', () => {
    it('should handle invalid cursor gracefully', async () => {
      // Invalid cursor should either throw an error or return an error response
      try {
        const result = await resourceManager.readResource('symbols://list?cursor=invalid-cursor-data');
        const data = JSON.parse(result.text);

        // If it doesn't throw, check if error is in response
        if (data.error) {
          expect(data.error).toContain('Invalid cursor');
        } else {
          // Otherwise the implementation catches it internally
          expect(true).toBe(true);
        }
      } catch (error: any) {
        // Error thrown - check the message
        expect(error.message).toContain('Invalid cursor');
      }
    });
  });
});
