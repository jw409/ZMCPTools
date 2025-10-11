#!/usr/bin/env node
/**
 * Test GPU search tools registration and basic functionality
 */

import { DatabaseManager } from '../src/database/DatabaseManager.js';
import { getGPUSearchTools } from '../src/tools/gpuSearchTools.js';

async function main() {
  console.log('🧪 Testing GPU Search Tools...\n');

  // Initialize database
  const db = new DatabaseManager();
  await db.initialize();
  console.log('✅ Database initialized');

  // Load GPU search tools
  const tools = getGPUSearchTools(db);
  console.log(`✅ Loaded ${tools.length} GPU search tools:\n`);

  tools.forEach((tool, i) => {
    console.log(`${i + 1}. ${tool.name}`);
    console.log(`   ${tool.description.split('\n')[0]}`);
    console.log(`   Schema: ${JSON.stringify(tool.inputSchema.properties, null, 2).split('\n').slice(0, 3).join('\n').slice(0, 80)}...`);
    console.log('');
  });

  // Test list_collections
  console.log('🧪 Testing list_collections...');
  const listTool = tools.find(t => t.name === 'list_collections');
  if (listTool) {
    const result = await listTool.handler({});
    console.log(`✅ Collections:`, JSON.stringify(result, null, 2));
  }

  // Test get_collection_stats
  console.log('\n🧪 Testing get_collection_stats...');
  const statsTool = tools.find(t => t.name === 'get_collection_stats');
  if (statsTool) {
    try {
      const result = await statsTool.handler({ collection: 'test_collection' });
      console.log(`✅ Stats:`, JSON.stringify(result, null, 2));
    } catch (error: any) {
      console.log(`⚠️  Expected error (collection doesn't exist):`, error.message);
    }
  }

  // Test search_knowledge (will fail if no collections exist)
  console.log('\n🧪 Testing search_knowledge...');
  const searchTool = tools.find(t => t.name === 'search_knowledge');
  if (searchTool) {
    try {
      const result = await searchTool.handler({
        query: 'test query',
        limit: 5
      });
      console.log(`✅ Search results:`, JSON.stringify(result, null, 2));
    } catch (error: any) {
      console.log(`⚠️  Expected error (no collections):`, error.message);
    }
  }

  await db.close();
  console.log('\n✅ All tests completed');
}

main().catch(console.error);
