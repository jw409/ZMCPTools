#!/usr/bin/env tsx
/**
 * Test embedding generation directly to see where it fails
 */

import { LanceDBService } from '../src/services/LanceDBService.js';
import { DatabaseManager } from '../src/database/index.js';

async function main() {
  // Create a minimal database manager (won't actually be used for this test)
  const dbManager = new DatabaseManager(':memory:');

  // Create LanceDB service with gemma_embed model
  const lanceDB = new LanceDBService(dbManager, {
    embeddingModel: 'gemma_embed',
    projectPath: process.cwd(),
    preferLocal: true
  });

  await lanceDB.initialize();

  console.log('Testing embedding generation...\n');

  try {
    // Try to add a single document
    const testDoc = {
      id: 'test',
      content: 'LanceDB vector search service implementation with GPU acceleration',
      metadata: { test: true }
    };

    console.log('Adding test document...');
    const result = await lanceDB.addDocuments('test_collection', [testDoc]);

    if (result.success) {
      console.log('✅ Document added successfully');

      // Now search for it
      console.log('\nSearching for similar content...');
      const searchResults = await lanceDB.searchSimilar('test_collection', 'LanceDB vector search', 5);

      console.log(`Found ${searchResults.length} results:`);
      searchResults.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.id} (score: ${r.score.toFixed(4)}, distance: ${r.distance.toFixed(4)})`);
      });

      if (searchResults.length > 0 && searchResults[0].score > 0.7) {
        console.log('\n✅ Search working correctly - high similarity for matching content!');
      } else {
        console.log('\n❌ Search broken - similarity too low for matching content');
      }
    } else {
      console.error('❌ Failed to add document:', result.error);
    }

    // Clean up
    await lanceDB.deleteCollection('test_collection');
    await lanceDB.shutdown();

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main().catch(console.error);
