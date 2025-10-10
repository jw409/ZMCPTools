#!/usr/bin/env tsx
import * as lancedb from '@lancedb/lancedb';

async function main() {
  const db = await lancedb.connect('var/storage/lancedb');
  const table = await db.openTable('symbol_graph_embeddings');
  const count = await table.countRows();
  console.log(`ZMCPTools project-local: ${count} documents`);

  // Also check global
  const db2 = await lancedb.connect('/home/jw/dev/game1/var/storage/lancedb');
  const table2 = await db2.openTable('symbol_graph_embeddings');
  const count2 = await table2.countRows();
  console.log(`Global storage: ${count2} documents`);
}

main();
