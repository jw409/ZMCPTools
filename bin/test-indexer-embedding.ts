#!/usr/bin/env tsx
import { SymbolGraphIndexer } from '../src/services/SymbolGraphIndexer.js';
import * as lancedb from '@lancedb/lancedb';

async function main() {
  console.log('Creating SymbolGraphIndexer instance...\n');

  const indexer = new SymbolGraphIndexer();
  await indexer.initialize(process.cwd());

  // Check if LanceDB service is using TalentOS
  const lanceDBService = (indexer as any).lanceDBService;
  console.log('LanceDB service exists:', !!lanceDBService);
  console.log('Using TalentOS:', (lanceDBService as any).usingTalentOS);
  console.log('Embedding model:', (lanceDBService as any).config?.embeddingModel);
  console.log();

  // Now check what's in the actual LanceDB collection
  const db = await lancedb.connect('var/storage/lancedb');
  const table = await db.openTable('symbol_graph_embeddings');
  const sample = await table.query().limit(1).toArray();

  console.log('Sample from LanceDB:');
  console.log('  ID:', sample[0].id);
  console.log('  Vector length:', sample[0].vector.length);

  // Get the first 10 values from the vector
  const vec: number[] = [];
  for (let i = 0; i < Math.min(10, sample[0].vector.length); i++) {
    vec.push(sample[0].vector.get(i));
  }
  console.log('  First 10 values:', vec.map(v => v.toFixed(4)));

  // Compare with a fresh GPU embedding
  const gpuResponse = await fetch('http://localhost:8765/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: sample[0].content, model: 'gemma_embed' })
  });
  const gpuResult = await gpuResponse.json();
  const gpuVec = gpuResult.embeddings[0];

  console.log('\nFresh GPU embedding for same text:');
  console.log('  Vector length:', gpuVec.length);
  console.log('  First 10 values:', gpuVec.slice(0, 10).map((v: number) => v.toFixed(4)));

  // Calculate similarity
  let dotProduct = 0;
  for (let i = 0; i < vec.length; i++) {
    dotProduct += vec[i] * gpuVec[i];
  }

  console.log(`\nSimilarity: ${dotProduct.toFixed(4)}`);
  console.log(dotProduct > 0.95 ? '✅ Embeddings match! Using GPU service correctly.' : '❌ Embeddings DO NOT match! Using fallback.');

  await indexer.close();
}

main().catch(console.error);
