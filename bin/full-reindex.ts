#!/usr/bin/env tsx
/**
 * Full reindex - clears SQLite AND LanceDB, then reindexes everything
 */

import { SymbolGraphIndexer } from '../src/services/SymbolGraphIndexer.js';

async function main() {
  console.log('Full reindex starting...\n');

  const indexer = new SymbolGraphIndexer();
  const projectPath = process.cwd();

  // Initialize indexer
  await indexer.initialize(projectPath);

  console.log('Clearing existing index...\n');
  await indexer.clearIndex();

  console.log('Indexing repository (this will take a few minutes)...\n');
  await indexer.indexRepository(projectPath);

  const stats = await indexer.getStats();
  console.log(`\n✅ Reindex complete!`);
  console.log(`   Files indexed: ${stats.totalFiles}`);
  console.log(`   With embeddings: ${stats.filesWithEmbeddings}`);

  await indexer.close();
}

main().catch(error => {
  console.error('❌ Failed to reindex:', error);
  process.exit(1);
});
