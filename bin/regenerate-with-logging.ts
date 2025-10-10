#!/usr/bin/env tsx
/**
 * Regenerate embeddings with explicit logging to debug TalentOS usage
 */

import { SymbolGraphIndexer } from '../src/services/SymbolGraphIndexer.js';

async function main() {
  console.log('Testing TalentOS GPU service first...\n');

  // Test GPU service directly
  try {
    const healthResponse = await fetch('http://localhost:8765/health');
    const health = await healthResponse.json();
    console.log('✅ GPU service is healthy');
    console.log(`   Device: ${health.device}`);
    console.log(`   Models loaded: ${JSON.stringify(health.models_loaded)}`);

    // Test embedding generation
    const embedResponse = await fetch('http://localhost:8765/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Test embedding', model: 'gemma_embed' })
    });
    const embedResult = await embedResponse.json();
    console.log(`✅ Embedding test successful (${embedResult.embeddings[0].length}D vector)\n`);
  } catch (error) {
    console.error('❌ GPU service test failed:', error);
    console.error('Cannot proceed without working GPU service!');
    process.exit(1);
  }

  console.log('Regenerating LanceDB embeddings...\n');

  const indexer = new SymbolGraphIndexer();
  const projectPath = process.cwd();

  await indexer.initialize(projectPath);

  const stats = await indexer.getStats();
  console.log(`Found ${stats.totalFiles} indexed files\n`);

  // Generate first batch with logging
  console.log('Generating embeddings (watching for errors)...');
  await (indexer as any).generatePendingEmbeddings();

  console.log('\n✅ Embeddings regenerated!');

  // Verify one embedding
  const verifyQuery = "LanceDB vector search";
  const results = await indexer.searchSemantic(verifyQuery, 3);
  console.log(`\nVerification search for "${verifyQuery}":`);
  results.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.filePath} (score: ${r.score.toFixed(4)})`);
  });

  await indexer.close();
}

main().catch(error => {
  console.error('❌ Failed:', error);
  process.exit(1);
});
