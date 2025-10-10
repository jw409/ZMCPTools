#!/usr/bin/env tsx
/**
 * Regenerate LanceDB embeddings from existing SQLite index
 */

import { SymbolGraphIndexer } from '../src/services/SymbolGraphIndexer.js';

async function main() {
  console.log('Regenerating LanceDB embeddings...\n');

  const indexer = new SymbolGraphIndexer();
  const projectPath = process.cwd();

  // Initialize indexer (connects to existing SQLite database)
  await indexer.initialize(projectPath);

  const stats = await indexer.getStats();
  console.log(`Found ${stats.totalFiles} indexed files in SQLite\n`);

  // Generate embeddings for all files
  console.log('Generating embeddings (this may take a few minutes with GPU service)...');
  await (indexer as any).generatePendingEmbeddings();

  console.log('\n✅ Embeddings regenerated successfully!');

  await indexer.close();
}

main().catch(error => {
  console.error('❌ Failed to regenerate embeddings:', error);
  process.exit(1);
});
