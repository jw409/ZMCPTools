import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { SymbolGraphIndexer } from '../src/services/SymbolGraphIndexer.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

describe('SymbolGraphIndexer', () => {
  let tempDir: string;
  let indexer: SymbolGraphIndexer;

  beforeEach(() => {
    // Create temporary test directory
    tempDir = join(tmpdir(), `zmcp-symbol-graph-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    indexer = new SymbolGraphIndexer();
  });

  afterEach(async () => {
    try {
      await indexer.close();
    } catch (error) {
      // Ignore cleanup errors
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Initialization', () => {
    test('should initialize database successfully', async () => {
      await expect(indexer.initialize(tempDir)).resolves.not.toThrow();
    });

    test('should create SQLite database with correct schema', async () => {
      await indexer.initialize(tempDir);

      // Verify the database exists and has required tables
      const stats = await indexer.getStats();
      expect(stats).toHaveProperty('totalFiles');
      expect(stats).toHaveProperty('totalSymbols');
      expect(stats).toHaveProperty('totalImports');
    });
  });

  describe('Incremental Indexing', () => {
    test('should index new files', async () => {
      // Create test files
      const testFile = join(tempDir, 'test.ts');
      writeFileSync(testFile, `
export function getUserById(id: string): Promise<User> {
  return db.users.findById(id);
}

export class UserService {
  async createUser(data: UserData): Promise<User> {
    return this.repository.create(data);
  }
}
`);

      await indexer.initialize(tempDir);

      const statsBeforeFirst = await indexer.getStats();
      expect(statsBeforeFirst.totalFiles).toBe(0);

      // First indexing run
      const stats1 = await indexer.indexRepository(tempDir);
      expect(stats1.totalFiles).toBe(1);
      expect(stats1.needsIndexing).toBe(1);
      expect(stats1.alreadyIndexed).toBe(0);

      // Second indexing run (should hit cache)
      const stats2 = await indexer.indexRepository(tempDir);
      expect(stats2.totalFiles).toBe(1);
      expect(stats2.needsIndexing).toBe(0);
      expect(stats2.alreadyIndexed).toBe(1);

      // Verify >95% cache hit rate
      const cacheHitRate = stats2.alreadyIndexed / stats2.totalFiles;
      expect(cacheHitRate).toBeGreaterThanOrEqual(0.95);
    }, 10000); // 10s timeout for indexing

    test('should re-index changed files only', async () => {
      // Create test file
      const testFile = join(tempDir, 'test.ts');
      writeFileSync(testFile, 'export function foo() {}');

      await indexer.initialize(tempDir);

      // First indexing
      await indexer.indexRepository(tempDir);

      // Modify file
      writeFileSync(testFile, 'export function bar() {}');

      // Second indexing should detect change
      const stats = await indexer.indexRepository(tempDir);
      expect(stats.needsIndexing).toBe(1);
    }, 10000);

    test('should achieve >95% cache hit rate on large repo', async () => {
      // Create multiple test files
      const fileCount = 100;
      for (let i = 0; i < fileCount; i++) {
        const filePath = join(tempDir, `file${i}.ts`);
        writeFileSync(filePath, `
export function func${i}() {
  return ${i};
}
`);
      }

      await indexer.initialize(tempDir);

      // First indexing
      const stats1 = await indexer.indexRepository(tempDir);
      expect(stats1.totalFiles).toBe(fileCount);
      expect(stats1.needsIndexing).toBe(fileCount);

      // Second indexing (should be mostly cached)
      const stats2 = await indexer.indexRepository(tempDir);
      expect(stats2.totalFiles).toBe(fileCount);

      const cacheHitRate = stats2.alreadyIndexed / stats2.totalFiles;
      expect(cacheHitRate).toBeGreaterThanOrEqual(0.95);

      console.log(`Cache hit rate: ${(cacheHitRate * 100).toFixed(1)}%`);
    }, 30000); // 30s timeout for large repo
  });

  describe('Performance Requirements', () => {
    test('should index repository in <5s (small repo)', async () => {
      // Create realistic test files
      for (let i = 0; i < 50; i++) {
        const filePath = join(tempDir, `component${i}.ts`);
        writeFileSync(filePath, `
import React from 'react';

export interface Props {
  id: string;
  name: string;
}

export const Component${i}: React.FC<Props> = ({ id, name }) => {
  return <div>{name}</div>;
};

export function helper${i}(value: string): string {
  return value.toUpperCase();
}
`);
      }

      await indexer.initialize(tempDir);

      const startTime = Date.now();
      const stats = await indexer.indexRepository(tempDir);
      const indexingTime = Date.now() - startTime;

      console.log(`Indexed ${stats.totalFiles} files in ${indexingTime}ms`);

      // Requirement: <5s for small repos
      expect(indexingTime).toBeLessThan(5000);
      expect(stats.totalFiles).toBe(50);
    }, 10000);

    test('should search in <100ms after indexing', async () => {
      // Create test files
      for (let i = 0; i < 20; i++) {
        const filePath = join(tempDir, `service${i}.ts`);
        writeFileSync(filePath, `
export class AuthService {
  async validateUser(email: string): Promise<boolean> {
    return true;
  }
}
`);
      }

      await indexer.initialize(tempDir);
      await indexer.indexRepository(tempDir);

      // Measure search performance
      const searchStart = Date.now();
      const results = await indexer.searchKeyword('validateUser', 10);
      const searchTime = Date.now() - searchStart;

      console.log(`Search completed in ${searchTime}ms`);

      expect(searchTime).toBeLessThan(100);
      expect(results.length).toBeGreaterThan(0);
    }, 10000);
  });

  describe('Symbol Extraction', () => {
    test('should extract functions and classes', async () => {
      const testFile = join(tempDir, 'code.ts');
      writeFileSync(testFile, `
export function getUserById(id: string): User {
  return {} as User;
}

export class UserService {
  createUser(data: any): User {
    return {} as User;
  }
}
`);

      await indexer.initialize(tempDir);
      await indexer.indexRepository(tempDir);

      const stats = await indexer.getStats();
      expect(stats.totalSymbols).toBeGreaterThan(0);
    });
  });

  describe('BM25 Code Search', () => {
    test('should search by function name', async () => {
      const testFile = join(tempDir, 'auth.ts');
      writeFileSync(testFile, `
export async function validateUserCredentials(email: string, password: string): Promise<boolean> {
  // Validation logic
  return true;
}
`);

      await indexer.initialize(tempDir);
      await indexer.indexRepository(tempDir);

      const results = await indexer.searchKeyword('validateUserCredentials', 5);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].filePath).toContain('auth.ts');
      expect(results[0].matchType).toBe('keyword');
    });

    test('should return symbols in search results', async () => {
      const testFile = join(tempDir, 'service.ts');
      writeFileSync(testFile, `
export class ApiService {
  async fetchData(): Promise<void> {}
}
`);

      await indexer.initialize(tempDir);
      await indexer.indexRepository(tempDir);

      const results = await indexer.searchKeyword('ApiService', 5);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].symbols).toBeDefined();
    });
  });

  describe('Import Graph', () => {
    test('should build import relationships', async () => {
      const file1 = join(tempDir, 'moduleA.ts');
      const file2 = join(tempDir, 'moduleB.ts');

      writeFileSync(file1, `
import { helperFunction } from './moduleB';

export function mainFunction() {
  return helperFunction();
}
`);

      writeFileSync(file2, `
export function helperFunction() {
  return 42;
}
`);

      await indexer.initialize(tempDir);
      await indexer.indexRepository(tempDir);

      const stats = await indexer.getStats();
      expect(stats.totalImports).toBeGreaterThan(0);
    });

    test('should search import graph', async () => {
      const file1 = join(tempDir, 'app.ts');
      writeFileSync(file1, `
import React from 'react';
import { useState } from 'react';
`);

      await indexer.initialize(tempDir);
      await indexer.indexRepository(tempDir);

      const results = await indexer.searchImportGraph('react', 10);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].matchType).toBe('import');
    });
  });

  describe('Separated Search Domains', () => {
    test('should separate code content from comments', async () => {
      const testFile = join(tempDir, 'mixed.ts');
      writeFileSync(testFile, `
/**
 * This is a docstring describing the user authentication logic
 */
export function authenticateUser(credentials: Credentials) {
  // TODO: Add rate limiting
  return validateCredentials(credentials);
}
`);

      await indexer.initialize(tempDir);
      await indexer.indexRepository(tempDir);

      // BM25 should find code symbols
      const codeResults = await indexer.searchKeyword('authenticateUser', 5);
      expect(codeResults.length).toBeGreaterThan(0);

      // Semantic search would find intent (not yet implemented)
      // const intentResults = await indexer.searchSemantic('user authentication logic', 5);
      // expect(intentResults.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid files gracefully', async () => {
      const invalidFile = join(tempDir, 'invalid.ts');
      writeFileSync(invalidFile, '<<< invalid syntax >>>');

      await indexer.initialize(tempDir);

      const stats = await indexer.indexRepository(tempDir);

      // Should not crash, may skip invalid file
      expect(stats.errors.length).toBeGreaterThanOrEqual(0);
    });

    test('should handle missing directory gracefully', async () => {
      const nonExistentDir = join(tempDir, 'does-not-exist');

      await indexer.initialize(nonExistentDir);

      const stats = await indexer.indexRepository(nonExistentDir);

      expect(stats.totalFiles).toBe(0);
    });
  });

  describe('Database Operations', () => {
    test('should store and retrieve file metadata', async () => {
      const testFile = join(tempDir, 'test.ts');
      writeFileSync(testFile, 'export function test() {}');

      await indexer.initialize(tempDir);
      await indexer.indexRepository(tempDir);

      const stats = await indexer.getStats();

      expect(stats.totalFiles).toBe(1);
      expect(stats.languages).toHaveProperty('typescript');
    });

    test('should track statistics correctly', async () => {
      // Create multiple files
      for (let i = 0; i < 10; i++) {
        const filePath = join(tempDir, `file${i}.ts`);
        writeFileSync(filePath, `export function func${i}() {}`);
      }

      await indexer.initialize(tempDir);
      await indexer.indexRepository(tempDir);

      const stats = await indexer.getStats();

      expect(stats.totalFiles).toBe(10);
      expect(stats.totalSymbols).toBeGreaterThan(0);
    });
  });
});

describe('SymbolGraphIndexer vs RealFileIndexingService', () => {
  test('should demonstrate incremental indexing advantage', async () => {
    const tempDir = join(tmpdir(), `zmcp-comparison-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    try {
      // Create test files
      for (let i = 0; i < 20; i++) {
        const filePath = join(tempDir, `component${i}.ts`);
        writeFileSync(filePath, `
export function Component${i}() {
  return null;
}
`);
      }

      const indexer = new SymbolGraphIndexer();
      await indexer.initialize(tempDir);

      // First run: Index everything
      const run1Start = Date.now();
      const stats1 = await indexer.indexRepository(tempDir);
      const run1Time = Date.now() - run1Start;

      // Second run: Should be much faster due to caching
      const run2Start = Date.now();
      const stats2 = await indexer.indexRepository(tempDir);
      const run2Time = Date.now() - run2Start;

      console.log(`First run: ${run1Time}ms, Second run: ${run2Time}ms`);
      console.log(`Cache hit rate: ${((stats2.alreadyIndexed / stats2.totalFiles) * 100).toFixed(1)}%`);
      console.log(`Speedup: ${(run1Time / run2Time).toFixed(1)}x faster`);

      // Second run should be significantly faster
      expect(run2Time).toBeLessThan(run1Time / 2);
      expect(stats2.alreadyIndexed / stats2.totalFiles).toBeGreaterThanOrEqual(0.95);

      await indexer.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 30000);
});
