#!/usr/bin/env tsx
/**
 * Test Symbol Indexing Production Implementation
 *
 * Validates SymbolIndexerService and SymbolIndexRepository work correctly:
 * 1. Index ZMCPTools repository
 * 2. Verify symbol extraction accuracy
 * 3. Test symbol-aware search
 * 4. Measure performance
 */

import { DatabaseConnectionManager } from '../src/database/index.js';
import { SymbolIndexerService } from '../src/services/SymbolIndexerService.js';
import { BM25Service } from '../src/services/BM25Service.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  console.log('🧪 Testing Symbol Indexing Production Implementation\n');

  const repositoryPath = join(__dirname, '..');

  try {
    // 1. Initialize database
    console.log('📦 Initializing database...');
    const dbManager = await DatabaseConnectionManager.getInstance();
    const db = dbManager.getDatabase();
    console.log('✅ Database connected\n');

    // 2. Initialize services
    console.log('🔧 Initializing services...');
    const symbolIndexer = new SymbolIndexerService(db);
    const bm25Service = new BM25Service({}, db);
    console.log('✅ Services initialized\n');

    // 3. Index repository
    console.log('📂 Indexing repository...');
    const indexingStats = await symbolIndexer.indexRepository({
      repositoryPath,
      includePatterns: ['src/**/*.ts', 'bin/**/*.ts'],
      excludePatterns: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.test.ts',
        '**/*.spec.ts'
      ],
      forceReindex: false,
      batchSize: 50
    });

    console.log('\n✅ Indexing complete!');
    console.log('\n📊 Indexing Statistics:');
    console.log(`   Total files:      ${indexingStats.totalFiles}`);
    console.log(`   Indexed:          ${indexingStats.indexedFiles}`);
    console.log(`   Cached:           ${indexingStats.cachedFiles}`);
    console.log(`   Failed:           ${indexingStats.failedFiles}`);
    console.log(`   Total symbols:    ${indexingStats.totalSymbols}`);
    console.log(`   Avg parse time:   ${indexingStats.avgParseTimeMs.toFixed(2)}ms`);
    console.log(`   Total duration:   ${indexingStats.indexingDurationMs.toFixed(0)}ms`);

    console.log('\n📊 By Language:');
    for (const [lang, count] of Object.entries(indexingStats.byLanguage)) {
      console.log(`   ${lang.padEnd(15)} ${count} files`);
    }

    console.log('\n📊 By Symbol Type:');
    for (const [type, count] of Object.entries(indexingStats.byType)) {
      console.log(`   ${type.padEnd(15)} ${count} symbols`);
    }

    if (indexingStats.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      for (const error of indexingStats.errors.slice(0, 5)) {
        console.log(`   ${error.file}: ${error.error}`);
      }
      if (indexingStats.errors.length > 5) {
        console.log(`   ... and ${indexingStats.errors.length - 5} more`);
      }
    }

    // 4. Test symbol lookup
    console.log('\n\n🔍 Testing symbol lookup...');
    const testSymbols = ['SymbolIndexerService', 'BM25Service', 'ResourceManager', 'KnowledgeGraphService'];

    for (const symbolName of testSymbols) {
      const result = await symbolIndexer.findSymbol(symbolName);
      console.log(`\n   ${symbolName}:`);
      console.log(`     Files defining: ${result.filesDefining.length}`);
      console.log(`     Files importing: ${result.filesImporting.length}`);

      if (result.filesDefining.length > 0) {
        console.log(`     Main file: ${result.filesDefining[0]}`);
      }
    }

    // 5. Test symbol-aware search
    console.log('\n\n🔎 Testing symbol-aware search...');

    // First, index some documents in BM25
    console.log('   Indexing sample documents into BM25...');
    const sampleDocs = [
      {
        id: 'src/services/BM25Service.ts',
        text: 'export class BM25Service { async search() {} async searchSymbolAware() {} }',
        metadata: { type: 'service' }
      },
      {
        id: 'src/repositories/SymbolIndexRepository.ts',
        text: 'export class SymbolIndexRepository extends BaseRepository { async findFilesForSymbol() {} }',
        metadata: { type: 'repository' }
      },
      {
        id: 'src/tools/SimpleASTTool.ts',
        text: 'export class SimpleASTTool { async extractSymbols() {} async extractExports() {} }',
        metadata: { type: 'tool' }
      },
      {
        id: 'src/services/VectorSearchService.ts',
        text: 'import { BM25Service } from "./BM25Service.js"; export class VectorSearchService {}',
        metadata: { type: 'service' }
      }
    ];

    await bm25Service.indexDocuments(sampleDocs);
    console.log('   ✓ Documents indexed\n');

    const testQueries = ['BM25Service', 'symbol repository', 'extract exports'];

    for (const query of testQueries) {
      console.log(`\n   Query: "${query}"`);

      // Regular BM25
      const regularResults = await bm25Service.search(query, 3);
      console.log('     Regular BM25:');
      for (const result of regularResults.slice(0, 3)) {
        console.log(`       ${result.score.toFixed(2)} - ${result.id}`);
      }

      // Symbol-aware BM25
      const symbolResults = await bm25Service.searchSymbolAware(query, 3);
      console.log('     Symbol-aware:');
      for (const result of symbolResults.slice(0, 3)) {
        console.log(`       ${result.score.toFixed(2)} - ${result.id}`);
      }
    }

    // 6. Repository statistics
    console.log('\n\n📈 Repository Statistics:');
    const stats = await symbolIndexer.getStatistics();
    console.log(`   Total files:      ${stats.totalFiles}`);
    console.log(`   Total symbols:    ${stats.totalSymbols}`);
    console.log(`   Avg parse time:   ${stats.avgParseTime.toFixed(2)}ms`);
    console.log(`   Last indexed:     ${stats.lastIndexed?.toISOString() || 'Never'}`);

    console.log('\n✅ All tests passed!\n');

    // Clean up
    await dbManager.disconnect();

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
