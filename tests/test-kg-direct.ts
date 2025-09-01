#!/usr/bin/env tsx

/**
 * Direct test of knowledge graph functionality
 */

import { KnowledgeGraphService } from '../ZMCPTools/dist/server/index.js';

// Define EntityType locally since it's in the types
enum EntityType {
  FILE = 'file',
  MODULE = 'module',
  COMPONENT = 'component',
  FUNCTION = 'function',
  CLASS = 'class',
  DOCUMENTATION = 'documentation',
  TODO = 'todo',
  ERROR = 'error',
  KNOWLEDGE_MEMORY = 'knowledge_memory',
  AGENT = 'agent',
  TASK = 'task',
  UNKNOWN = 'unknown'
}

async function testKnowledgeGraph() {
  console.log('🧪 Testing Knowledge Graph Directly\n');
  
  const kg = new KnowledgeGraphService();
  
  // Test 1: Store knowledge memories
  console.log('1. Storing test memories...');
  
  const testMemories = [
    {
      type: EntityType.KNOWLEDGE_MEMORY,
      name: 'Database Architecture Decision',
      description: 'We selected PostgreSQL with JSONB columns for flexible schema evolution and excellent query performance on semi-structured data',
      metadata: {
        memory_type: 'technical_decision',
        agent_id: 'test-agent-kg',
        confidence: 0.95
      }
    },
    {
      type: EntityType.KNOWLEDGE_MEMORY,
      name: 'React Performance Issue',
      description: 'useState hooks in UserDashboard component caused infinite re-renders when updating nested objects. Solution: use useReducer instead',
      metadata: {
        memory_type: 'error_pattern',
        agent_id: 'test-agent-kg',
        confidence: 0.9
      }
    },
    {
      type: EntityType.KNOWLEDGE_MEMORY,
      name: 'JWT Authentication Pattern',
      description: 'JWT tokens stored in httpOnly cookies with CSRF protection provides the best security for our SPA architecture',
      metadata: {
        memory_type: 'implementation_pattern',
        agent_id: 'test-agent-kg',
        confidence: 0.85
      }
    }
  ];
  
  const createdEntities = [];
  
  for (const memory of testMemories) {
    try {
      const entity = await kg.createEntity('.', memory);
      createdEntities.push(entity);
      console.log(`  ✅ Created: ${memory.name} (ID: ${entity.id})`);
    } catch (error) {
      console.log(`  ❌ Failed to create: ${memory.name}`, error);
    }
  }
  
  // Wait a bit for indexing
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 2: Basic text search
  console.log('\n2. Testing basic text search...');
  
  const basicSearches = [
    { query: 'PostgreSQL', expected: 'Database Architecture Decision' },
    { query: 'useState', expected: 'React Performance Issue' },
    { query: 'JWT', expected: 'JWT Authentication Pattern' },
    { query: 'performance', expected: 'should find multiple results' },
    { query: 'nonexistent', expected: 'should find nothing' }
  ];
  
  for (const search of basicSearches) {
    try {
      const results = await kg.findEntitiesByTextSearch('.', search.query, [EntityType.KNOWLEDGE_MEMORY], 10);
      console.log(`  Query "${search.query}": Found ${results.length} results`);
      if (results.length > 0) {
        console.log(`    First: ${results[0].name}`);
      }
    } catch (error) {
      console.log(`  Query "${search.query}": Error -`, error);
    }
  }
  
  // Test 3: Semantic search
  console.log('\n3. Testing semantic search...');
  
  const semanticSearches = [
    { query: 'database selection criteria', expected: 'Database Architecture Decision' },
    { query: 'React component rendering problems', expected: 'React Performance Issue' },
    { query: 'authentication security best practices', expected: 'JWT Authentication Pattern' },
    { query: 'how to make pizza', expected: 'should find nothing relevant' }
  ];
  
  for (const search of semanticSearches) {
    try {
      const results = await kg.findSimilarEntities('.', search.query, [EntityType.KNOWLEDGE_MEMORY], 5);
      console.log(`  Query "${search.query}": Found ${results.length} results`);
      if (results.length > 0 && results[0].score !== undefined) {
        console.log(`    Best match: ${results[0].name} (score: ${results[0].score.toFixed(3)})`);
      }
    } catch (error) {
      console.log(`  Query "${search.query}": Error -`, error);
    }
  }
  
  // Test 4: Check vector store status
  console.log('\n4. Checking vector store...');
  try {
    const stats = await kg.getStatistics();
    console.log('  Knowledge Graph Statistics:');
    console.log(`    Total entities: ${stats.totalEntities}`);
    console.log(`    By type:`, stats.byType);
    console.log(`    By repository:`, stats.byRepository);
  } catch (error) {
    console.log('  Error getting statistics:', error);
  }
  
  console.log('\n✅ Knowledge Graph Test Complete!');
  
  // Close the service
  kg.close();
}

// Run the test
testKnowledgeGraph().catch(console.error);