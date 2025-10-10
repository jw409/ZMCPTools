#!/usr/bin/env node
/**
 * Demonstration: Semantic Search Superiority
 *
 * Indexes ZMCPTools project and demonstrates semantic search vs keyword search
 * Shows how Gemma3 embeddings excel at intent-based queries
 */

import { SymbolGraphIndexer } from '../src/services/SymbolGraphIndexer.js';
import { Logger } from '../src/utils/logger.js';

const logger = new Logger('demo-semantic-search');

async function main() {
  const projectPath = process.cwd();
  logger.info('='.repeat(80));
  logger.info('SEMANTIC SEARCH DEMONSTRATION');
  logger.info('='.repeat(80));

  // Initialize indexer
  logger.info('\n1. Initializing SymbolGraphIndexer...');
  const indexer = new SymbolGraphIndexer();
  await indexer.initialize(projectPath);

  // Index the project
  logger.info('\n2. Indexing ZMCPTools project...');
  const startIndex = Date.now();
  const stats = await indexer.indexRepository(projectPath);
  const indexTime = Date.now() - startIndex;

  logger.info(`   ✓ Indexed ${stats.totalFiles} files in ${indexTime}ms`);
  logger.info(`   ✓ Cache hit rate: ${((stats.alreadyIndexed / stats.totalFiles) * 100).toFixed(1)}%`);
  logger.info(`   ✓ New files indexed: ${stats.needsIndexing}`);

  const dbStats = await indexer.getStats();
  logger.info(`   ✓ Total symbols: ${dbStats.totalSymbols}`);
  logger.info(`   ✓ Total imports: ${dbStats.totalImports}`);

  // Test queries demonstrating semantic superiority
  const queries = [
    {
      semantic: 'vector database embeddings and similarity search',
      keyword: 'LanceDB',
      description: 'Intent: Find vector database implementation'
    },
    {
      semantic: 'authentication and user login security',
      keyword: 'authenticate',
      description: 'Intent: Find auth-related code'
    },
    {
      semantic: 'indexing files and tracking changes',
      keyword: 'index',
      description: 'Intent: Find indexing logic'
    },
    {
      semantic: 'parse and extract code structure from source files',
      keyword: 'AST parser',
      description: 'Intent: Find AST parsing'
    }
  ];

  for (let i = 0; i < queries.length; i++) {
    const { semantic, keyword, description } = queries[i];

    logger.info('\n' + '='.repeat(80));
    logger.info(`Query ${i + 1}: ${description}`);
    logger.info('='.repeat(80));

    // Semantic search
    logger.info(`\n🔍 SEMANTIC: "${semantic}"`);
    const startSem = Date.now();
    const semResults = await indexer.searchSemantic(semantic, 5);
    const semTime = Date.now() - startSem;

    logger.info(`   Search time: ${semTime}ms`);
    semResults.slice(0, 3).forEach((result, idx) => {
      const meta = result.metadata;
      const authInfo = meta ? ` [${meta.partition}@${meta.authorityScore?.toFixed(2)}]` : '';
      logger.info(`   ${idx + 1}. ${result.filePath}${authInfo} (weighted: ${result.score.toFixed(3)})`);
      if (meta?.originalScore) {
        logger.info(`      Original: ${meta.originalScore.toFixed(3)} × Authority: ${meta.authorityScore?.toFixed(2)} = ${result.score.toFixed(3)}`);
      }
      if (result.snippet) {
        logger.info(`      "${result.snippet.substring(0, 80)}..."`);
      }
    });

    // Keyword search
    logger.info(`\n🔤 KEYWORD: "${keyword}"`);
    const startKey = Date.now();
    const keyResults = await indexer.searchKeyword(keyword, 5);
    const keyTime = Date.now() - startKey;

    logger.info(`   Search time: ${keyTime}ms`);
    keyResults.slice(0, 3).forEach((result, idx) => {
      const meta = result.metadata;
      const authInfo = meta ? ` [${meta.partition}@${meta.authorityScore?.toFixed(2)}]` : '';
      logger.info(`   ${idx + 1}. ${result.filePath}${authInfo} (weighted: ${result.score.toFixed(3)})`);
      if (meta?.originalScore) {
        logger.info(`      Original: ${meta.originalScore.toFixed(3)} × Authority: ${meta.authorityScore?.toFixed(2)} = ${result.score.toFixed(3)}`);
      }
    });

    // Analysis
    logger.info('\n📊 ANALYSIS:');
    logger.info(`   Semantic results: ${semResults.length} files`);
    logger.info(`   Keyword results: ${keyResults.length} files`);

    if (semResults.length > 0 && keyResults.length > 0) {
      const semanticAvgScore = semResults.reduce((sum, r) => sum + r.score, 0) / semResults.length;
      const keywordAvgScore = keyResults.reduce((sum, r) => sum + r.score, 0) / keyResults.length;
      logger.info(`   Semantic avg confidence: ${semanticAvgScore.toFixed(3)}`);
      logger.info(`   Keyword avg confidence: ${keywordAvgScore.toFixed(3)}`);
    }
  }

  // Summary
  logger.info('\n' + '='.repeat(80));
  logger.info('SUMMARY');
  logger.info('='.repeat(80));
  logger.info('\n✅ Semantic search demonstrates:');
  logger.info('   • Intent-based matching (finds relevant code without exact keywords)');
  logger.info('   • Concept understanding (Gemma3 768D embeddings)');
  logger.info('   • Documentation search (docstrings, comments, markdown)');
  logger.info('\n✅ Keyword search excels at:');
  logger.info('   • Exact symbol matching (function names, class names)');
  logger.info('   • Code-level precision (BM25 on AST-extracted symbols)');
  logger.info('   • Import graph traversal');
  logger.info('\n🎯 Complementary strengths:');
  logger.info('   • Semantic: "What does this code DO?" (intent domain)');
  logger.info('   • Keyword: "WHERE is this symbol?" (code domain)');
  logger.info('\n✨ Phase 1: Authority-Weighted Search:');
  logger.info('   • Partition classification (dom0: 0.95, project: 0.35, whiteboard: 0.10)');
  logger.info('   • Weighted scoring: similarity × authority_score');
  logger.info('   • Constitutional files (CLAUDE.md, etc/) rank higher for same relevance');

  await indexer.close();
  logger.info('\n✓ Demo complete\n');
}

main().catch(error => {
  logger.error('Demo failed', { error: error.message });
  process.exit(1);
});
