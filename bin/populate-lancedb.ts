#!/usr/bin/env tsx
/**
 * Populate LanceDB with embeddings from existing SQLite index
 * Fixes the issue where SQLite index exists but LanceDB is empty
 */

import { SymbolGraphIndexer } from '../src/services/SymbolGraphIndexer.js';

async function populateLanceDB() {
  console.log('Populating LanceDB from existing SQLite index...\n');

  const indexer = new SymbolGraphIndexer();
  const projectPath = process.cwd();

  try {
    // Initialize (connects to existing SQLite index)
    console.log('Initializing indexer...');
    await indexer.initialize(projectPath);

    // Check current stats
    const stats = await indexer.getStats();
    console.log(`\nCurrent SQLite index:`);
    console.log(`  Files: ${stats.totalFiles}`);
    console.log(`  Symbols: ${stats.totalSymbols}`);
    console.log(`  Imports: ${stats.totalImports}`);

    if (stats.totalFiles === 0) {
      console.log('\n❌ No SQLite index found. Run indexRepository() first.');
      process.exit(1);
    }

    // Generate embeddings for all files (will populate LanceDB)
    console.log('\n📊 Generating embeddings and populating LanceDB...');
    console.log('This will:');
    console.log('  1. Read embedding_text from SQLite semantic_metadata');
    console.log('  2. Generate vectors via GPU (port 8765)');
    console.log('  3. Store in LanceDB collection "symbol_graph_embeddings"');
    console.log('');

    // This method reads from semantic_metadata and populates LanceDB
    await (indexer as any).generatePendingEmbeddings();

    console.log('\n✅ LanceDB population complete!');
    console.log('\nVerify with: ReadMcpResourceTool(server="zmcp-tools", uri="vector://status")');

    await indexer.close();

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

populateLanceDB();
