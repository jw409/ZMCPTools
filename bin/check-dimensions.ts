#!/usr/bin/env tsx
import * as lancedb from '@lancedb/lancedb';

async function main() {
  const db = await lancedb.connect('var/storage/lancedb');
  const table = await db.openTable('symbol_graph_embeddings');

  // Check the schema
  const schema = await table.schema;
  console.log('=== LanceDB Schema ===');
  console.log(JSON.stringify(schema, null, 2));

  // Get a sample row
  const sample = await table.query().limit(1).toArray();

  if (sample.length > 0) {
    console.log('\n=== Sample Row ===');
    console.log(`ID: ${sample[0].id}`);
    console.log(`Vector dimension: ${sample[0].vector.length}`);
    console.log(`Content length: ${sample[0].content.length} chars`);
  }

  // Count total rows
  const count = await table.countRows();
  console.log(`\n=== Collection Stats ===`);
  console.log(`Total rows: ${count}`);
}

main();
