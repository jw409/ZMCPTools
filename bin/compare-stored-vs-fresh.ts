#!/usr/bin/env tsx
import * as lancedb from '@lancedb/lancedb';

async function main() {
  // Get stored embedding for LanceDBService.ts
  const db = await lancedb.connect('var/storage/lancedb');
  const table = await db.openTable('symbol_graph_embeddings');
  const rows = await table.query().limit(300).toArray();

  const lanceDBRow = rows.find((r: any) => r.id.includes('LanceDBService.ts'));

  if (!lanceDBRow) {
    console.error('❌ LanceDBService.ts not found in database');
    return;
  }

  // Get stored embedding
  const storedVector: number[] = [];
  for (let i = 0; i < lanceDBRow.vector.length; i++) {
    storedVector.push(lanceDBRow.vector.get(i));
  }

  console.log('=== Stored embedding in LanceDB ===');
  console.log(`Content: ${lanceDBRow.content.substring(0, 100)}...`);
  console.log(`Vector length: ${storedVector.length}`);
  console.log(`First 10 values: [${storedVector.slice(0, 10).map(v => v.toFixed(4)).join(', ')}]`);

  // Generate fresh embedding using TalentOS GPU
  console.log('\n=== Fresh GPU embedding ===');
  const gpuResponse = await fetch('http://localhost:8765/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: lanceDBRow.content, model: 'gemma_embed' })
  });

  const gpuResult = await gpuResponse.json();
  const freshVector = gpuResult.embeddings[0];

  console.log(`Vector length: ${freshVector.length}`);
  console.log(`First 10 values: [${freshVector.slice(0, 10).map(v => v.toFixed(4)).join(', ')}]`);

  // Calculate cosine similarity
  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;

  for (let i = 0; i < Math.min(storedVector.length, freshVector.length); i++) {
    dotProduct += storedVector[i] * freshVector[i];
    mag1 += storedVector[i] * storedVector[i];
    mag2 += freshVector[i] * freshVector[i];
  }

  const similarity = dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));

  console.log(`\n=== Similarity ===`);
  console.log(`Cosine similarity: ${similarity.toFixed(4)}`);

  if (similarity > 0.95) {
    console.log('✅ Embeddings match! Using real GPU embeddings.');
  } else if (similarity > 0.7) {
    console.log('⚠️  Embeddings partially match - possible drift or model change');
  } else {
    console.log('❌ Embeddings DO NOT match! Database has FALLBACK embeddings, not GPU embeddings!');
  }
}

main();
