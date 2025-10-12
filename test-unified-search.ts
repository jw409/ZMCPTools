#!/usr/bin/env node
/**
 * Test unified search to verify indexing works
 */

import { UnifiedSearchService } from './dist/services/UnifiedSearchService.js';

async function testSearch() {
  console.log('🔍 Testing Unified Search...\n');

  const searchService = new UnifiedSearchService({
    repositoryPath: '/home/jw/dev/game1',
    bm25Weight: 0.3,
    semanticWeight: 0.7,
    useBM25: true,
    useGPUEmbeddings: true,
    useReranker: false,
  });

  // Test 1: Search for HybridSearchService
  console.log('Test 1: Search for "HybridSearchService implementation"');
  const results1 = await searchService.search({
    query: 'HybridSearchService implementation',
    limit: 5,
  });

  console.log(`  Found ${results1.results.length} results`);
  results1.results.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.file_path} (score: ${r.final_score?.toFixed(3)})`);
  });

  // Test 2: Search for code symbols
  console.log('\nTest 2: Search for "class SymbolGraphIndexer"');
  const results2 = await searchService.search({
    query: 'class SymbolGraphIndexer',
    limit: 5,
  });

  console.log(`  Found ${results2.results.length} results`);
  results2.results.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.file_path} (score: ${r.final_score?.toFixed(3)})`);
  });

  // Test 3: Check metrics
  console.log('\n📊 Search Metrics:');
  console.log(`  Total time: ${results1.metrics.total_time_ms}ms`);
  console.log(`  GPU available: ${results1.metrics.gpu_available}`);
  console.log(`  Model: ${results1.metrics.model_used}`);

  console.log('\n✅ Search test complete');
}

testSearch().catch(console.error);
