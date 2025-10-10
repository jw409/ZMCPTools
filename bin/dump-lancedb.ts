#!/usr/bin/env tsx
/**
 * Dump all LanceDB documents to see what's actually stored
 */

import { LanceDBService } from '../src/services/LanceDBService.js';

async function main() {
  const lancedb = new LanceDBService();
  await lancedb.initialize();

  // Search with a generic query to get results
  try {
    const results = await lancedb.searchSimilar(
      'symbol_graph_embeddings',
      'test query',
      100,  // Get up to 100 docs
      0.0   // No threshold
    );

    console.log(`\n📊 Found ${results.length} documents in LanceDB\n`);

    for (let i = 0; i < Math.min(10, results.length); i++) {
      const doc = results[i];
      console.log(`Document ${i + 1}:`);
      console.log(`  ID: ${doc.id}`);
      console.log(`  Content: ${doc.content.substring(0, 80)}...`);
      console.log(`  Metadata: ${JSON.stringify(doc.metadata, null, 2)}`);
      console.log();
    }
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
