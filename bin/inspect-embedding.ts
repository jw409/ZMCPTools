#!/usr/bin/env tsx
import * as lancedb from '@lancedb/lancedb';

async function main() {
  const db = await lancedb.connect('var/storage/lancedb');
  const table = await db.openTable('symbol_graph_embeddings');

  // Find LanceDBService.ts
  const allDocs = await table.query().limit(1000).toArray();
  const target = allDocs.find(d => d.id.includes('LanceDBService'));

  if (!target) {
    console.log('LanceDBService.ts not found!');
    return;
  }

  console.log('Found:', target.id);
  console.log('Content preview:', target.content.substring(0, 200));
  console.log('Vector dimension:', target.vector.length);
  console.log('Vector norm:', Math.sqrt(target.vector.reduce((sum: number, v: number) => sum + v*v, 0)));
  console.log('First 10 values:', Array.from(target.vector.slice(0, 10)));
}

main().catch(console.error);
