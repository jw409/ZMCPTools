#!/usr/bin/env tsx
import * as lancedb from '@lancedb/lancedb';

async function main() {
  // Generate a fresh embedding using the GPU service
  const testText = "LanceDB vector search service";

  const response = await fetch('http://localhost:8765/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: testText, model: 'gemma_embed' })
  });

  const result = await response.json();
  const freshEmbedding = result.embeddings[0];

  console.log('Fresh embedding from GPU service:');
  console.log(`  Dimension: ${freshEmbedding.length}`);
  console.log(`  First 10: [${freshEmbedding.slice(0, 10).map((v: number) => v.toFixed(4)).join(', ')}]`);

  // Now get an embedding from LanceDB
  const db = await lancedb.connect('var/storage/lancedb');
  const table = await db.openTable('symbol_graph_embeddings');

  const docs = await table.query().limit(10).toArray();
  const lanceDoc = docs[1]; // Skip init document

  console.log(`\nEmbedding from LanceDB (${lanceDoc.id}):`);
  const lanceVec: number[] = [];
  for (let i = 0; i < lanceDoc.vector.length; i++) {
    lanceVec.push(lanceDoc.vector.get(i));
  }
  console.log(`  Dimension: ${lanceVec.length}`);
  console.log(`  First 10: [${lanceVec.slice(0, 10).map(v => v.toFixed(4)).join(', ')}]`);

  // Calculate similarity between fresh embedding and Lance embedding
  let dotProduct = 0;
  for (let i = 0; i < freshEmbedding.length; i++) {
    dotProduct += freshEmbedding[i] * lanceVec[i];
  }

  console.log(`\nCosine similarity between query and random doc: ${dotProduct.toFixed(4)}`);
  console.log('(Should be low ~0.1-0.3 for unrelated content)');
}

main().catch(console.error);
