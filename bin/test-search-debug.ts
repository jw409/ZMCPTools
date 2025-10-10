#!/usr/bin/env tsx
/**
 * Debug search results
 */

import { SymbolGraphIndexer } from '../src/services/SymbolGraphIndexer.js';

async function main() {
  const indexer = new SymbolGraphIndexer();
  await indexer.initialize(process.cwd());

  const query = "semantic embedding vector search GPU lance database";
  console.log(`\n🔍 Searching for: "${query}"\n`);

  const results = await indexer.searchSemantic(query, 10);

  console.log(`📊 Got ${results.length} results:\n`);
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.filePath || '<NO FILE PATH>'}`);
    console.log(`   Score: ${r.score?.toFixed(4) || 'N/A'}`);
    console.log(`   Metadata: ${JSON.stringify(r.metadata || {})}`);
    console.log();
  });

  await indexer.close();
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
