#!/usr/bin/env tsx
import * as lancedb from '@lancedb/lancedb';

async function main() {
  const db = await lancedb.connect('var/storage/lancedb');
  const table = await db.openTable('symbol_graph_embeddings');

  const allDocs = await table.query().limit(20).toArray();

  console.log('Checking embedding diversity...\n');

  for (let i = 0; i < Math.min(5, allDocs.length); i++) {
    const doc = allDocs[i];
    const vec = doc.vector;

    // Convert to regular array
    const vecArray: number[] = [];
    for (let j = 0; j < vec.length; j++) {
      vecArray.push(vec.get(j));
    }

    const norm = Math.sqrt(vecArray.reduce((sum, v) => sum + v * v, 0));
    const mean = vecArray.reduce((sum, v) => sum + v, 0) / vecArray.length;
    const std = Math.sqrt(vecArray.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / vecArray.length);

    console.log(`${i + 1}. ${doc.id}`);
    console.log(`   Norm: ${norm.toFixed(4)}, Mean: ${mean.toFixed(6)}, StdDev: ${std.toFixed(6)}`);
    console.log(`   First 5 values: [${vecArray.slice(0, 5).map(v => v.toFixed(4)).join(', ')}]`);
    console.log();
  }
}

main().catch(console.error);
