#!/usr/bin/env tsx
/**
 * Debug reindex - indexes a small subset of files for debugging.
 */

import { SymbolGraphIndexer, IndexStats } from '../src/services/SymbolGraphIndexer.js';
import * as path from 'path';

async function main() {
  console.log('DEBUG reindex starting...\n');

  const indexer = new SymbolGraphIndexer();
  const projectPath = process.cwd();

  // Initialize indexer
  await indexer.initialize(projectPath);

  const filesToIndex = [
    path.join(projectPath, 'ZMCPTools/src/services/SymbolGraphIndexer.ts'),
    path.join(projectPath, 'ZMCPTools/src/tools/IndexSymbolGraphTool.ts'),
    path.join(projectPath, 'talent-os/bin/start_embedding_service.py'),
    path.join(projectPath, 'talent-os/establishment_daemon.py'),
  ];

  console.log(`Indexing a subset of ${filesToIndex.length} files...\n`);

  const stats: IndexStats = {
    totalFiles: filesToIndex.length,
    indexedFiles: 0,
    alreadyIndexed: 0,
    needsIndexing: 0,
    skipped: 0,
    errors: []
  };

  for (const filePath of filesToIndex) {
    const needsReindex = await indexer.shouldReindex(filePath);
    if (needsReindex) {
      // @ts-ignore - private method access for debugging
      await indexer.indexFile(filePath, stats);
    } else {
      console.log(`Skipping ${path.basename(filePath)} (already indexed and unchanged).`);
      stats.alreadyIndexed++;
    }
  }

  console.log('\nGenerating pending embeddings for the subset...\n');
  // @ts-ignore - private method access for debugging
  await indexer.generatePendingEmbeddings();

  const finalStats = await indexer.getStats();
  console.log(`\n✅ DEBUG Reindex complete!`);
  console.log(`   Files indexed in this run: ${stats.indexedFiles}`);
  console.log(`   Total files in DB: ${finalStats.totalFiles}`);
  console.log(`   Total with embeddings: ${finalStats.filesWithEmbeddings}`);

  await indexer.close();
}

main().catch(error => {
  console.error('❌ Failed to run debug reindex:', error);
  process.exit(1);
});
