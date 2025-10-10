#!/usr/bin/env tsx
/**
 * Test direct LanceDB search to debug why benchmark fails
 */

import { SymbolGraphIndexer } from '../src/services/SymbolGraphIndexer.js';

async function main() {
  const indexer = new SymbolGraphIndexer();
  await indexer.initialize(process.cwd());

  const query = "LanceDB vector search service implementation";
  console.log(`Searching for: "${query}"\n`);

  const results = await indexer.searchSemantic(query, 10);

  console.log(`Found ${results.length} results:\n`);
  results.forEach((result, i) => {
    console.log(`${i + 1}. ${result.filePath}`);
    console.log(`   Score: ${result.score.toFixed(4)} (orig: ${result.metadata.originalScore?.toFixed(4)}, auth: ${result.metadata.authorityScore})`);
    console.log(`   Snippet: ${result.snippet.substring(0, 100)}...`);
    console.log();
  });

  await indexer.close();
}

main().catch(console.error);
