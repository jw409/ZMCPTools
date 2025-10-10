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

  console.log('Testing full search results for "LanceDB vector database"...\n');

  // Get TOP 20 results to see where LanceDBService.ts actually ranks
  const results = await lanceDB.searchSimilar('symbol_graph_embeddings', 'LanceDB vector database search service', 20, 0.0);

  console.log(`Found ${results.length} results:\n`);
  results.forEach((r, i) => {
    const isTarget = r.id.includes('LanceDBService.ts');
    const marker = isTarget ? '🎯' : '  ';
    console.log(`${marker} ${i + 1}. ${r.id} (score: ${r.score.toFixed(4)}, distance: ${r.distance.toFixed(4)})`);
  });

  await lanceDB.shutdown();
}

main();
