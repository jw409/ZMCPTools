/**
 * GPU-enabled indexing validation test
 * Run while monitoring: watch -n 1 'curl -s http://localhost:8765/health | jq'
 */

import { describe, it, expect } from 'vitest';
import { RealFileIndexingService } from '../src/services/RealFileIndexingService.js';
import * as path from 'path';

describe('GPU Embedding Validation', () => {
  it('should generate embeddings for indexed files using GPU', async () => {
    const service = new RealFileIndexingService();
    const projectRoot = process.cwd();

    console.log('\n🔥 Starting GPU-enabled indexing - monitor VRAM usage now!');
    console.log('   Run: watch -n 1 \'curl -s http://localhost:8765/health | jq\'\n');

    // Clear any existing index
    service.clear();

    // Index with verbose logging
    const startTime = Date.now();
    const stats = await service.indexRepository(projectRoot);
    const duration = Date.now() - startTime;

    console.log('\n📊 Indexing Complete:');
    console.log(`   Files indexed: ${stats.indexedFiles}`);
    console.log(`   Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
    console.log(`   Languages: ${JSON.stringify(stats.languages, null, 2)}`);
    console.log(`   Errors: ${stats.errors.length}`);

    // Verify embeddings were actually generated
    const indexStats = service.getIndexStats();
    console.log(`\n🎯 Embeddings generated: ${indexStats.hasEmbeddings}`);

    expect(indexStats.hasEmbeddings).toBe(true);
    expect(stats.indexedFiles).toBeGreaterThan(0);

    // Test semantic search to prove embeddings work
    console.log('\n🔍 Testing semantic search with GPU embeddings...');
    const searchResults = await service.searchSemantic('file indexing service', 5);

    console.log(`   Results found: ${searchResults.length}`);
    if (searchResults.length > 0) {
      console.log('   Top result:', {
        file: path.basename(searchResults[0].filePath),
        score: searchResults[0].score.toFixed(4),
        symbols: searchResults[0].relevantSymbols?.length || 0
      });
    }

    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0].score).toBeGreaterThan(0);

    console.log('\n✅ GPU embeddings validated successfully!\n');

  }, 120000); // 2 minute timeout
});
