#!/usr/bin/env node
/**
 * Direct test of ZMCPTools semantic search using MCP tools
 */

async function testSemanticSearch() {
  console.log('=== TESTING SEMANTIC SEARCH USING MCP TOOLS ===\n');

  try {
    // Test 1: Search knowledge graph with semantic search
    console.log('1. Testing semantic search through MCP tool...');
    const searchResults = await mcp__zmcp_tools__search_knowledge_graph({
      repository_path: '/home/jw/dev/game1',
      query: 'authentication security',
      use_semantic_search: true,
      threshold: 0.3,
      limit: 10
    });
    
    console.log(`   Found ${searchResults.entities.length} entities`);
    searchResults.entities.slice(0, 5).forEach((entity, i) => {
      console.log(`   ${i+1}. ${entity.entity_type}: ${entity.name}`);
      console.log(`      ${entity.description?.substring(0, 60)}...`);
    });
    
    // Test 2: Try with even lower threshold
    console.log('\n2. Testing with very low threshold (0.1)...');
    const lowThresholdResults = await mcp__zmcp_tools__search_knowledge_graph({
      repository_path: '/home/jw/dev/game1',
      query: 'authentication',
      use_semantic_search: true,
      threshold: 0.1,
      limit: 10
    });
    
    console.log(`   Found ${lowThresholdResults.entities.length} entities`);
    
    // Test 3: Direct text search for comparison
    console.log('\n3. Testing direct text search (non-semantic)...');
    const textResults = await mcp__zmcp_tools__search_knowledge_graph({
      repository_path: '/home/jw/dev/game1',
      query: 'authentication',
      use_semantic_search: false,
      limit: 10
    });
    
    console.log(`   Found ${textResults.entities.length} entities with text search`);
    textResults.entities.slice(0, 3).forEach((entity, i) => {
      console.log(`   ${i+1}. ${entity.entity_type}: ${entity.name}`);
    });
    
    console.log('\n=== TEST COMPLETE ===');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
testSemanticSearch();