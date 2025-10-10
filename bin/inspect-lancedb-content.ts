#!/usr/bin/env tsx
import * as lancedb from '@lancedb/lancedb';

async function main() {
  const db = await lancedb.connect('var/storage/lancedb');
  const table = await db.openTable('symbol_graph_embeddings');

  // Get all rows
  const allRows = await table.query().limit(300).toArray();

  // Find the specific files we care about
  const targets = ['LanceDBService.ts', 'BM25Service.ts', 'PartitionClassifier.ts', 'debug_test.js'];

  for (const target of targets) {
    const row = allRows.find((r: any) => r.id.includes(target));
    if (row) {
      console.log(`\n=== ${target} ===`);
      console.log(`ID: ${row.id}`);
      console.log(`Content length: ${row.content.length} chars`);
      console.log(`Content preview: ${row.content.substring(0, 200)}`);
      console.log(`Vector dimension: ${row.vector.length}`);

      // Get first 10 values of embedding
      const vec: number[] = [];
      for (let i = 0; i < 10; i++) {
        vec.push(row.vector.get(i));
      }
      console.log(`Vector sample: [${vec.map(v => v.toFixed(4)).join(', ')}]`);
    } else {
      console.log(`\n❌ ${target} NOT FOUND`);
    }
  }
}

main();
