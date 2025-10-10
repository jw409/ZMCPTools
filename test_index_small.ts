#!/usr/bin/env tsx
/**
 * Test script for index_symbol_graph functionality
 * Tests small file indexing (STEP 4 of test protocol)
 */

import { getSymbolGraphIndexer } from './src/services/SymbolGraphIndexer.js';

async function testSmallIndex() {
  console.log('=== STEP 4: Small Index Test ===\n');

  const repositoryPath = '/home/jw/dev/game1/ZMCPTools';
  const testFile = 'src/services/SymbolGraphIndexer.ts';

  console.log(`Repository: ${repositoryPath}`);
  console.log(`Test file: ${testFile}\n`);

  try {
    const indexer = getSymbolGraphIndexer();
    await indexer.initialize(repositoryPath);

    console.log('Indexer initialized');
    console.log('Starting indexing...\n');

    const startTime = Date.now();
    const stats = await indexer.indexRepository(repositoryPath);
    const duration = Date.now() - startTime;

    console.log('=== Indexing Complete ===');
    console.log(`Duration: ${duration}ms`);
    console.log(`Total files: ${stats.totalFiles}`);
    console.log(`Indexed: ${stats.indexedFiles}`);
    console.log(`Already indexed: ${stats.alreadyIndexed}`);
    console.log(`Skipped: ${stats.skipped}`);
    console.log(`Total symbols: ${stats.totalSymbols || 0}`);
    console.log(`Files with embeddings: ${stats.filesWithEmbeddings || 0}`);
    console.log(`Cache hit rate: ${(stats.alreadyIndexed / Math.max(stats.totalFiles, 1)).toFixed(2)}`);

    if (stats.errors.length > 0) {
      console.log(`\nErrors (${stats.errors.length}):`);
      stats.errors.forEach(err => console.log(`  - ${err}`));
    }

    // Now get stats
    console.log('\n=== Database Stats ===');
    const dbStats = await indexer.getStats();
    console.log(`DB total files: ${dbStats.totalFiles}`);
    console.log(`DB total symbols: ${dbStats.totalSymbols || 0}`);
    console.log(`DB files with embeddings: ${dbStats.filesWithEmbeddings || 0}`);

    process.exit(0);
  } catch (error) {
    console.error('FAILED:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

testSmallIndex();
