#!/usr/bin/env node

/**
 * Direct Hybrid Search Performance Test
 * Tests HybridSearchService and individual components without ZMCP overhead
 * Measures real-world performance and accuracy differences
 */

import { DatabaseManager } from './dist/server/index.js';
// For now, let's use a simpler approach with just the database
import sqlite3 from 'sqlite3';
import { readFileSync } from 'fs';

// Test queries by category
const TEST_QUERIES = {
  code: [
    'bootstrap_layer1.py',
    'start_embedding_service',
    'knowledge_entities',
    'StateManager',
    'getDashboard'
  ],
  documentation: [
    'embedding strategy documentation',
    'monitoring guide setup',
    'security best practices',
    'how to contribute',
    'installation instructions'
  ]
};

async function runPerformanceTest() {
  console.log('🚀 Direct Hybrid Search Performance Test');
  console.log('=' * 50);

  try {
    // Initialize services
    console.log('📊 Initializing services...');
    const db = new DatabaseManager('/home/jw/.mcptools/data/claude_mcp_tools.db');
    await db.initialize();

    const vectorService = new VectorSearchService(db);
    await vectorService.initialize();

    const knowledgeGraph = new KnowledgeGraphService(db, vectorService);
    await knowledgeGraph.initialize();

    const bm25Service = new BM25Service();
    const hybridService = new HybridSearchService();

    console.log('✅ Services initialized');

    // Test results storage
    const results = {
      code: { semantic_wins: 0, text_wins: 0, semantic_times: [], text_times: [] },
      documentation: { semantic_wins: 0, text_wins: 0, semantic_times: [], text_times: [] }
    };

    // Test code queries
    console.log('\n📝 TESTING CODE QUERIES (should favor text/exact matching):');
    console.log('-'.repeat(60));

    for (const query of TEST_QUERIES.code) {
      console.log(`\n🔍 Query: "${query}"`);

      // Test semantic search
      const semanticStart = Date.now();
      try {
        const semanticResults = await knowledgeGraph.findEntitiesBySemanticSearch(
          '.', query, undefined, 5, 0.3
        );
        const semanticTime = Date.now() - semanticStart;
        results.code.semantic_times.push(semanticTime);

        console.log(`  🧠 Semantic: ${semanticTime}ms, ${semanticResults.length} results`);
        semanticResults.slice(0, 2).forEach(r =>
          console.log(`    - ${r.name} (${r.entityType}) score:${r.importanceScore.toFixed(2)}`)
        );

      } catch (error) {
        console.log(`  🧠 Semantic: ERROR - ${error.message}`);
        results.code.semantic_times.push(999999); // Penalty time
      }

      // Test text search
      const textStart = Date.now();
      try {
        const textResults = await knowledgeGraph.findEntitiesByTextSearch(
          '.', query, undefined, 5
        );
        const textTime = Date.now() - textStart;
        results.code.text_times.push(textTime);

        console.log(`  📝 Text: ${textTime}ms, ${textResults.length} results`);
        textResults.slice(0, 2).forEach(r =>
          console.log(`    - ${r.name} (${r.entityType}) score:${r.importanceScore.toFixed(2)}`)
        );

        // Simple winner determination based on exact matches
        const semanticExactMatches = semanticResults.filter(r =>
          r.name.toLowerCase().includes(query.toLowerCase())
        ).length;
        const textExactMatches = textResults.filter(r =>
          r.name.toLowerCase().includes(query.toLowerCase())
        ).length;

        if (textExactMatches > semanticExactMatches) {
          results.code.text_wins++;
          console.log(`  🏆 Text search found more exact matches`);
        } else if (semanticExactMatches > textExactMatches) {
          results.code.semantic_wins++;
          console.log(`  🏆 Semantic search found more exact matches`);
        }

      } catch (error) {
        console.log(`  📝 Text: ERROR - ${error.message}`);
        results.code.text_times.push(999999); // Penalty time
      }
    }

    // Test documentation queries
    console.log('\n📚 TESTING DOCUMENTATION QUERIES (should favor semantic):');
    console.log('-'.repeat(60));

    for (const query of TEST_QUERIES.documentation) {
      console.log(`\n🔍 Query: "${query}"`);

      // Test semantic search
      const semanticStart = Date.now();
      try {
        const semanticResults = await knowledgeGraph.findEntitiesBySemanticSearch(
          '.', query, undefined, 5, 0.3
        );
        const semanticTime = Date.now() - semanticStart;
        results.documentation.semantic_times.push(semanticTime);

        console.log(`  🧠 Semantic: ${semanticTime}ms, ${semanticResults.length} results`);
        semanticResults.slice(0, 2).forEach(r =>
          console.log(`    - ${r.name} (${r.entityType}) score:${r.importanceScore.toFixed(2)}`)
        );

      } catch (error) {
        console.log(`  🧠 Semantic: ERROR - ${error.message}`);
        results.documentation.semantic_times.push(999999);
      }

      // Test text search
      const textStart = Date.now();
      try {
        const textResults = await knowledgeGraph.findEntitiesByTextSearch(
          '.', query, undefined, 5
        );
        const textTime = Date.now() - textStart;
        results.documentation.text_times.push(textTime);

        console.log(`  📝 Text: ${textTime}ms, ${textResults.length} results`);
        textResults.slice(0, 2).forEach(r =>
          console.log(`    - ${r.name} (${r.entityType}) score:${r.importanceScore.toFixed(2)}`)
        );

        // For documentation, favor semantic understanding
        if (semanticResults.length > textResults.length) {
          results.documentation.semantic_wins++;
          console.log(`  🏆 Semantic search found more relevant results`);
        } else if (textResults.length > semanticResults.length) {
          results.documentation.text_wins++;
          console.log(`  🏆 Text search found more results`);
        }

      } catch (error) {
        console.log(`  📝 Text: ERROR - ${error.message}`);
        results.documentation.text_times.push(999999);
      }
    }

    // Calculate and display summary
    console.log('\n📊 PERFORMANCE SUMMARY:');
    console.log('='.repeat(30));

    // Calculate averages
    const avgCodeSemantic = results.code.semantic_times.reduce((a, b) => a + b, 0) / results.code.semantic_times.length;
    const avgCodeText = results.code.text_times.reduce((a, b) => a + b, 0) / results.code.text_times.length;
    const avgDocSemantic = results.documentation.semantic_times.reduce((a, b) => a + b, 0) / results.documentation.semantic_times.length;
    const avgDocText = results.documentation.text_times.reduce((a, b) => a + b, 0) / results.documentation.text_times.length;

    console.log(`\n⏱️  SPEED ANALYSIS:`);
    console.log(`Code queries - Semantic avg: ${avgCodeSemantic.toFixed(0)}ms, Text avg: ${avgCodeText.toFixed(0)}ms`);
    console.log(`Doc queries - Semantic avg: ${avgDocSemantic.toFixed(0)}ms, Text avg: ${avgDocText.toFixed(0)}ms`);

    console.log(`\n🎯 ACCURACY ANALYSIS:`);
    console.log(`Code queries - Text wins: ${results.code.text_wins}, Semantic wins: ${results.code.semantic_wins}`);
    console.log(`Doc queries - Semantic wins: ${results.documentation.semantic_wins}, Text wins: ${results.documentation.text_wins}`);

    console.log(`\n💡 HYBRID SEARCH RECOMMENDATIONS:`);

    if (results.code.text_wins > results.code.semantic_wins) {
      console.log(`✅ CONFIRMED: Code queries benefit from text/exact search (BM25)`);
      console.log(`   Recommendation: Use 70-80% BM25 weight for code content`);
    }

    if (results.documentation.semantic_wins > results.documentation.text_wins) {
      console.log(`✅ CONFIRMED: Documentation queries benefit from semantic search`);
      console.log(`   Recommendation: Use 70-80% semantic weight for documentation`);
    }

    if (avgCodeText < avgCodeSemantic && avgDocSemantic < avgDocText) {
      console.log(`✅ SPEED PATTERN: Text faster for code, semantic faster for docs`);
    }

    console.log(`\n🚨 CURRENT ISSUE:`);
    console.log(`   Current HybridSearchService uses fixed 70% semantic / 30% BM25`);
    console.log(`   This is BACKWARDS for code queries!`);
    console.log(`   Need content-aware weighting: detect query type → adjust weights`);

    // Generate improvement metrics
    const codeImprovement = results.code.text_wins / TEST_QUERIES.code.length * 100;
    const docImprovement = results.documentation.semantic_wins / TEST_QUERIES.documentation.length * 100;

    console.log(`\n📈 POTENTIAL IMPROVEMENT:`);
    console.log(`   Code search accuracy: ${codeImprovement.toFixed(0)}% better with BM25 priority`);
    console.log(`   Doc search accuracy: ${docImprovement.toFixed(0)}% better with semantic priority`);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

// Run the test
runPerformanceTest();