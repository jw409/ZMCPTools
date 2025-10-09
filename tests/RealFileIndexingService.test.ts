/**
 * Test RealFileIndexingService with large project tree
 * Test scope: ZMCPTools + TalentOS *.md files
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { RealFileIndexingService } from '../src/services/RealFileIndexingService.js';
import * as path from 'path';

describe('RealFileIndexingService - Large Project Test', () => {
  let service: RealFileIndexingService;
  const projectRoot = process.cwd();

  beforeAll(() => {
    service = new RealFileIndexingService();
  });

  it('should index ZMCPTools files successfully', async () => {
    const stats = await service.indexRepository(projectRoot);

    // Verify indexing completed
    expect(stats.totalFiles).toBeGreaterThan(0);
    expect(stats.indexedFiles).toBeGreaterThan(0);
    expect(stats.indexingTimeMs).toBeGreaterThan(0);

    // Should have indexed some language
    expect(Object.keys(stats.languages).length).toBeGreaterThan(0);

    // Log stats for visibility
    console.log('Indexing stats:', {
      totalFiles: stats.totalFiles,
      indexedFiles: stats.indexedFiles,
      skippedFiles: stats.skippedFiles,
      languages: stats.languages,
      symbolTypes: stats.symbols,
      errorCount: stats.errors.length,
      sampleErrors: stats.errors.slice(0, 3), // Show first 3 errors if any
      avgTimePerFile: (stats.indexingTimeMs / stats.indexedFiles).toFixed(2) + 'ms'
    });

    // Should complete in reasonable time (<30s for large repo)
    expect(stats.indexingTimeMs).toBeLessThan(30000);

    // Should have minimal errors
    expect(stats.errors.length).toBeLessThan(stats.totalFiles * 0.2); // <20% error rate
  }, 60000); // 60 second timeout

  it('should search indexed markdown files by keyword', async () => {
    // First index
    await service.indexRepository(projectRoot);

    // Search for common term in markdown files
    const results = await service.searchKeyword('SymbolGraphIndexer', 5);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchType).toBe('keyword');
    expect(results[0].filePath).toBeDefined();
    expect(results[0].score).toBeGreaterThan(0);

    console.log('Search results:', results.map(r => ({
      file: path.basename(r.filePath),
      score: r.score.toFixed(3),
      preview: r.content.substring(0, 100) + '...'
    })));
  }, 60000);

  it('should provide accurate index stats', async () => {
    await service.indexRepository(projectRoot);

    const stats = service.getIndexStats();

    expect(stats.totalFiles).toBeGreaterThan(0);
    expect(stats.languages).toBeDefined();
    expect(Object.keys(stats.languages).length).toBeGreaterThan(0);

    console.log('Index stats:', stats);
  }, 60000);
});
