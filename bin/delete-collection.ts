#!/usr/bin/env tsx
/**
 * Delete a LanceDB collection
 * Usage: tsx bin/delete-collection.ts <collection_name>
 */

import { DatabaseConnectionManager } from '../src/database/index.js';
import { VectorSearchService } from '../src/services/VectorSearchService.js';

async function main() {
  const collectionName = process.argv[2] || 'zmcptools_benchmark';

  console.log(`🗑️  Deleting collection: ${collectionName}`);

  try {
    const dbManager = await DatabaseConnectionManager.getInstance();
    const vectorService = new VectorSearchService(dbManager, {
      embeddingModel: 'gemma_embed'
    });

    await vectorService.initialize();

    const result = await vectorService.deleteCollection(collectionName);

    if (result.success) {
      console.log(`✅ Collection ${collectionName} deleted successfully`);
    } else {
      console.log(`⚠️  Failed to delete collection: ${result.error}`);
    }

    await vectorService.shutdown();
    process.exit(0);

  } catch (error) {
    console.error(`❌ Error:`, error);
    process.exit(1);
  }
}

main().catch(console.error);
