#!/usr/bin/env node
/**
 * Direct test of ZMCPTools semantic search to find the exact issue
 */

import { DatabaseManager } from './ZMCPTools/src/database/index.js';
import { VectorSearchService } from './ZMCPTools/src/services/VectorSearchService.js';
import { KnowledgeGraphService } from './ZMCPTools/src/services/KnowledgeGraphService.js';

async function testSemanticSearch() {
  console.log('=== TESTING ZMCP SEMANTIC SEARCH DIRECTLY ===\n');

  try {
    // Initialize database
    const db = new DatabaseManager();
    await db.initialize();
    
    // Initialize vector service
    const vectorService = new VectorSearchService(db);
    await vectorService.initialize();
    
    // Initialize knowledge graph
    const knowledgeGraph = new KnowledgeGraphService(db, vectorService);
    
    // Test 1: Direct vector search
    console.log('1. Testing direct vector search...');
    const vectorResults = await vectorService.searchSimilar(
      'knowledge_graph',
      'authentication security',
      10,
      0.1  // Very low threshold
    );
    
    console.log(`   Found ${vectorResults.length} results from vector search`);
    vectorResults.slice(0, 3).forEach((result, i) => {
      console.log(`   ${i+1}. ID: ${result.id}`);
      console.log(`      Content: ${result.content.substring(0, 60)}...`);
      console.log(`      Score: ${result.similarity}, Distance: ${result.distance}`);
    });
    
    // Test 2: Knowledge graph semantic search
    console.log('\n2. Testing knowledge graph semantic search...');
    const kgResults = await knowledgeGraph.findEntitiesBySemanticSearch(
      '/home/jw/dev/game1',
      'authentication security',
      undefined,
      10,
      0.1  // Very low threshold
    );
    
    console.log(`   Found ${kgResults.length} entities from KG search`);
    kgResults.slice(0, 3).forEach((entity, i) => {
      console.log(`   ${i+1}. ${entity.entityType}: ${entity.name}`);
      console.log(`      ${entity.description?.substring(0, 60)}...`);
    });
    
    // Test 3: Try without repository path filter
    console.log('\n3. Testing ALL repositories...');
    const allRepoResults = await db.drizzle
      .select()
      .from(knowledgeGraph.constructor.knowledgeEntities)
      .execute();
    
    const repoStats = new Map<string, number>();
    allRepoResults.forEach(entity => {
      const count = repoStats.get(entity.repositoryPath) || 0;
      repoStats.set(entity.repositoryPath, count + 1);
    });
    
    console.log('   Repository distribution:');
    for (const [repo, count] of repoStats) {
      console.log(`   - ${repo}: ${count} entities`);
    }
    
    db.close();
    console.log('\n=== TEST COMPLETE ===');
    
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

testSemanticSearch();