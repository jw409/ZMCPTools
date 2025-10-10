#!/usr/bin/env tsx
/**
 * Check LanceDB collection status
 */

import { LanceDBService } from '../src/services/LanceDBService.js';

async function main() {
  const lancedb = new LanceDBService();
  await lancedb.initialize();

  // Check collection stats using searchMetadata (no vector needed)
  try {
    const results = await lancedb.searchMetadata('symbol_graph_embeddings', {});
    console.log(`✅ LanceDB collection exists: ${results.length} rows`);

    console.log('\nSample rows with authority metadata:');
    for (const row of results.slice(0, 10)) {
      console.log(`  ${row.metadata?.file_path || row.id}`);
      console.log(`    partition: ${row.metadata?.partition_id}, authority: ${row.metadata?.authority_score}`);
    }
  } catch (error: any) {
    console.log(`❌ Error accessing collection: ${error.message}`);
  }
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
