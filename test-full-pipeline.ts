#!/usr/bin/env node
/**
 * End-to-end test of full search pipeline:
 * AST → Symbols → Embeddings → Hybrid Search → Reranker
 */

import { indexKnowledgeTool } from './src/tools/IndexKnowledgeTool.js';
import { HybridSearchService } from './src/services/HybridSearchService.js';
import { EmbeddingClient } from './src/services/EmbeddingClient.js';
import { BM25Service } from './src/services/BM25Service.js';
import * as path from 'path';
import * as fs from 'fs';

async function testFullPipeline() {
  console.log('🧪 Testing Full Search Pipeline\n');
  console.log('=' .repeat(60));

  const repositoryPath = path.resolve('/home/jw/dev/game1/ZMCPTools');

  // Step 1: Index code symbols with embeddings
  console.log('\n📚 Step 1: Indexing code symbols with embeddings...');
  console.log('-'.repeat(60));

  try {
    const indexResult = await indexKnowledgeTool.handler({
      repository_path: repositoryPath,
      sources: {
        github_issues: false,  // Skip for speed
        markdown_docs: false,  // Skip for speed
        code_symbols: true     // Test code symbols only
      },
      skip_embeddings: false,  // Enable embeddings!
      output_path: path.join(repositoryPath, 'var/storage/pipeline_test_knowledge.json')
    });

    console.log(indexResult.content[0].text);

    // Step 2: Load indexed knowledge
    console.log('\n📖 Step 2: Loading indexed knowledge...');
    console.log('-'.repeat(60));

    const knowledgePath = path.join(repositoryPath, 'var/storage/pipeline_test_knowledge.json');
    const knowledgeData = JSON.parse(fs.readFileSync(knowledgePath, 'utf-8'));

    console.log(`✅ Loaded ${knowledgeData.length} documents`);

    // Count embeddings
    const withEmbeddings = knowledgeData.filter((doc: any) => doc.embedding && doc.embedding.length > 0);
    console.log(`   - ${withEmbeddings.length} with embeddings (${((withEmbeddings.length/knowledgeData.length)*100).toFixed(1)}%)`);

    if (withEmbeddings.length > 0) {
      console.log(`   - Embedding dimensions: ${withEmbeddings[0].embedding.length}`);
    }

    // Step 3: Initialize Hybrid Search Service
    console.log('\n🔍 Step 3: Initializing Hybrid Search with Reranker...');
    console.log('-'.repeat(60));

    const embeddingClient = new EmbeddingClient();
    const bm25Service = new BM25Service();
    const hybridSearch = new HybridSearchService(embeddingClient, bm25Service);

    // Index documents for search
    console.log('Indexing documents for hybrid search...');
    const documentsToIndex = knowledgeData.slice(0, 100).map((doc: any) => ({
      id: doc.id,
      text: doc.content,
      metadata: {
        type: doc.type,
        symbol_kind: doc.symbol_kind,
        symbol_name: doc.symbol_name,
        file_path: doc.relative_path
      }
    }));

    await hybridSearch.indexDocuments(documentsToIndex);
    console.log(`✅ Indexed ${documentsToIndex.length} documents`);

    // Step 4: Test search queries with reranker
    console.log('\n🔎 Step 4: Testing search queries with reranker...');
    console.log('-'.repeat(60));

    const testQueries = [
      'embedding generation service',
      'AST parser tree-sitter',
      'hybrid search algorithm'
    ];

    for (const query of testQueries) {
      console.log(`\n📝 Query: "${query}"`);

      const searchResult = await hybridSearch.search(query, {
        max_results: 5,
        use_reranker: true  // Enable reranker!
      });

      console.log(`   Results: ${searchResult.results.length}`);
      console.log(`   Stats:`);
      console.log(`     - Dense: ${searchResult.stats.dense_results} results, ${searchResult.stats.dense_time_ms}ms`);
      console.log(`     - Sparse: ${searchResult.stats.sparse_results} results, ${searchResult.stats.sparse_time_ms}ms`);
      console.log(`     - Fusion: ${searchResult.stats.fusion_time_ms}ms`);
      if (searchResult.stats.reranker_applied) {
        console.log(`     - Reranker: ✅ Applied, ${searchResult.stats.reranker_time_ms}ms`);
      } else {
        console.log(`     - Reranker: ⏭️  Skipped`);
      }
      console.log(`     - Total: ${searchResult.stats.total_time_ms}ms`);

      console.log(`   Top 3 Results:`);
      searchResult.results.slice(0, 3).forEach((result, index) => {
        const meta = result.metadata || {};
        const symbolName = meta.symbol_name || result.id.split('-').slice(-2, -1)[0] || 'unknown';
        const symbolKind = meta.symbol_kind || result.id.split('-').slice(-1)[0] || 'unknown';
        const filePath = meta.file_path || result.id.split('-')[1] || 'unknown';

        console.log(`     ${index + 1}. ${symbolName} (${symbolKind})`);
        console.log(`        File: ${filePath}`);
        console.log(`        Score: ${result.combined_score.toFixed(4)}`);
        if (result.reranker_score !== undefined) {
          console.log(`        Reranker: ${result.reranker_score.toFixed(4)} (rank ${result.final_rank})`);
        }
      });
    }

    // Step 5: Compare with and without reranker
    console.log('\n📊 Step 5: Comparing reranker impact...');
    console.log('-'.repeat(60));

    const testQuery = 'search embedding vectors';

    console.log(`\nQuery: "${testQuery}"`);

    // Without reranker
    console.log('\n❌ WITHOUT Reranker:');
    const withoutReranker = await hybridSearch.search(testQuery, {
      max_results: 5,
      use_reranker: false
    });

    withoutReranker.results.slice(0, 3).forEach((result, index) => {
      console.log(`  ${index + 1}. ${result.metadata?.symbol_name} - Score: ${result.combined_score.toFixed(4)}`);
    });

    // With reranker
    console.log('\n✅ WITH Reranker:');
    const withReranker = await hybridSearch.search(testQuery, {
      max_results: 5,
      use_reranker: true
    });

    withReranker.results.slice(0, 3).forEach((result, index) => {
      const symbolName = result.metadata?.symbol_name || result.id.split('-').slice(-2, -1)[0] || 'unknown';
      console.log(`  ${index + 1}. ${symbolName} - Reranker: ${result.reranker_score?.toFixed(4)}, RRF: ${result.sparse_score?.toFixed(4)}`);
    });

    // Calculate quality improvement
    console.log('\n💡 Key Insight: Reranker Re-orders Results by Quality');
    console.log(`   Without reranker: Top result score = ${withoutReranker.results[0]?.combined_score.toFixed(4)}`);
    console.log(`   With reranker: Top result score = ${withReranker.results[0]?.reranker_score?.toFixed(4)}`);
    console.log(`   Reranker provides semantic relevance scoring (0.0-1.0)`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ Full Pipeline Test Complete!\n');
    console.log('Pipeline: AST → Symbols → Embeddings → Hybrid Search → Reranker');
    console.log(`Total time: ${withReranker.stats.total_time_ms}ms`);
    console.log(`Reranker overhead: ${withReranker.stats.reranker_time_ms}ms (<50ms typical)`);
    console.log(`\n🎯 Quality First: Local GPU reranker improves relevance with minimal latency`);

  } catch (error) {
    console.error('\n❌ Pipeline test failed:', error);
    process.exit(1);
  }
}

testFullPipeline();
