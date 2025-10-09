/**
 * Test RealFileIndexingService on large TalentOS project
 * Goal: Validate indexing of 12,134 Python files + documentation
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { RealFileIndexingService } from '../src/services/RealFileIndexingService.js';
import * as path from 'path';

describe('RealFileIndexingService - TalentOS Large Project Test', () => {
  let service: RealFileIndexingService;
  const talentOSRoot = path.resolve(process.cwd(), '../talent-os');

  beforeAll(() => {
    service = new RealFileIndexingService();
  });

  it('should index TalentOS project with 12,134 Python files', async () => {
    const stats = await service.indexRepository(talentOSRoot);

    // Verify indexing completed
    expect(stats.totalFiles).toBeGreaterThan(10000); // Should find >10k files
    expect(stats.indexedFiles).toBeGreaterThan(10000); // Should index >10k files
    expect(stats.indexingTimeMs).toBeGreaterThan(0);

    // Should have indexed Python files
    expect(stats.languages['python']).toBeGreaterThan(10000);

    // Log comprehensive stats for visibility
    console.log('TalentOS Indexing Results:', {
      totalFiles: stats.totalFiles,
      indexedFiles: stats.indexedFiles,
      skippedFiles: stats.skippedFiles,
      languages: stats.languages,
      symbolTypes: stats.symbols,
      errorCount: stats.errors.length,
      sampleErrors: stats.errors.slice(0, 10), // Show first 10 errors if any
      avgTimePerFile: (stats.indexingTimeMs / stats.indexedFiles).toFixed(2) + 'ms',
      totalTime: (stats.indexingTimeMs / 1000).toFixed(2) + 's',
      filesPerSecond: (stats.indexedFiles / (stats.indexingTimeMs / 1000)).toFixed(2)
    });

    // Should complete in reasonable time (<5min for 12k files = ~25ms/file average)
    expect(stats.indexingTimeMs).toBeLessThan(5 * 60 * 1000);

    // Should have minimal errors (<5% error rate)
    expect(stats.errors.length).toBeLessThan(stats.totalFiles * 0.05);

    // Should have extracted symbols from Python files
    expect(stats.symbols['function']).toBeGreaterThan(0);
    expect(stats.symbols['class']).toBeGreaterThan(0);

  }, 300000); // 5 minute timeout for large project

  it('should search TalentOS files by keyword', async () => {
    // Index if not already indexed
    await service.indexRepository(talentOSRoot);

    // Search for common terms in TalentOS
    const results = await service.searchKeyword('agent', 10);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchType).toBe('keyword');
    expect(results[0].filePath).toBeDefined();
    expect(results[0].score).toBeGreaterThan(0);

    console.log('TalentOS Search Results (keyword "agent"):', results.map(r => ({
      file: path.basename(r.filePath),
      score: r.score.toFixed(3),
      symbols: r.relevantSymbols?.length || 0
    })));
  }, 300000);
});
