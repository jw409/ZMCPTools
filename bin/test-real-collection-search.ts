#!/usr/bin/env tsx
import { LanceDBService } from '../src/services/LanceDBService.js';
import { DatabaseManager } from '../src/database/index.js';

async function main() {
  const dbManager = new DatabaseManager(':memory:');

  const lanceDB = new LanceDBService(dbManager, {
    embeddingModel: 'gemma_embed',
    projectPath: process.cwd(),
    preferLocal: true
  });

  await lanceDB.initialize();

  console.log('Searching symbol_graph_embeddings collection...\n');

  const queries = [
    'LanceDB vector database search service',
    'BM25 ranking algorithm implementation',
    'partition classification authority'
  ];

  for (const query of queries) {
    console.log(`Query: "${query}"`);
    const results = await lanceDB.searchSimilar('symbol_graph_embeddings', query, 5, 0.3);

    console.log(`  Found ${results.length} results:`);
    results.slice(0, 3).forEach((r, i) => {
      console.log(`    ${i + 1}. ${r.id} (score: ${r.score.toFixed(4)})`);
    });
    console.log();
  }

  await lanceDB.shutdown();
}

main().catch(console.error);
