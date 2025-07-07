#!/usr/bin/env node

/**
 * Test script for automatic foundation caching functionality
 * Verifies that the enhanced FoundationCacheService works correctly
 */

import { FoundationCacheService } from './src/services/FoundationCacheService.js';
import { ClaudeDatabase } from './src/database/index.js';
import { resolve } from 'path';

async function testFoundationCaching() {
  console.log('🧪 Testing Automatic Foundation Caching System\n');

  // Initialize services
  const database = new ClaudeDatabase();
  const foundationCache = new FoundationCacheService(database, {
    autoFoundationSessions: true,
    projectHashValidityHours: 1,
    enableMetrics: true
  });

  try {
    const currentProject = resolve('.');
    console.log(`📁 Testing with project: ${currentProject}\n`);

    // Test 1: Automatic foundation session creation
    console.log('1️⃣ Testing automatic foundation session creation...');
    const sessionId1 = await foundationCache.getOrCreateFoundationSession(currentProject);
    console.log(`   ✅ Created session: ${sessionId1}`);

    // Test 2: Reusing existing session
    console.log('\n2️⃣ Testing session reuse...');
    const sessionId2 = await foundationCache.getOrCreateFoundationSession(currentProject);
    console.log(`   ✅ Reused session: ${sessionId2}`);
    console.log(`   🔍 Same session? ${sessionId1 === sessionId2 ? 'Yes' : 'No'}`);

    // Test 3: Project hash calculation
    console.log('\n3️⃣ Testing project hash calculation...');
    const projectHash = await foundationCache.calculateProjectHash(currentProject);
    console.log(`   ✅ Project hash: ${projectHash.substring(0, 16)}...`);

    // Test 4: File hash tracking
    console.log('\n4️⃣ Testing file hash tracking...');
    const fileHashes = await foundationCache.calculateFileHashes(currentProject);
    const fileCount = Object.keys(fileHashes).length;
    console.log(`   ✅ Tracked ${fileCount} key files`);
    Object.entries(fileHashes).slice(0, 3).forEach(([file, hash]) => {
      console.log(`   📄 ${file}: ${hash.substring(0, 12)}...`);
    });

    // Test 5: Session validation
    console.log('\n5️⃣ Testing session validation...');
    const isValid = await foundationCache.isFoundationSessionValid(sessionId1, currentProject);
    console.log(`   ✅ Session valid? ${isValid ? 'Yes' : 'No'}`);

    // Test 6: Cache with automatic session
    console.log('\n6️⃣ Testing automatic caching...');
    const testContent = JSON.stringify({ test: 'data', timestamp: Date.now() });
    const testFilePath = resolve('./test-file.json');
    
    // First call - should create cache entry
    const cachedResult1 = await foundationCache.getCachedAnalysis(
      testFilePath,
      testContent,
      'test_template'
    );
    console.log(`   🔍 First cache lookup: ${cachedResult1 ? 'Hit' : 'Miss'}`);

    // Store a result
    const testResult = { analysis: 'test result', processed: true };
    const cacheEntryId = await foundationCache.cacheAnalysisResult(
      testFilePath,
      testContent,
      'test_template',
      testResult
    );
    console.log(`   ✅ Cached result with ID: ${cacheEntryId}`);

    // Second call - should hit cache
    const cachedResult2 = await foundationCache.getCachedAnalysis(
      testFilePath,
      testContent,
      'test_template'
    );
    console.log(`   🔍 Second cache lookup: ${cachedResult2 ? 'Hit' : 'Miss'}`);
    if (cachedResult2) {
      console.log(`   📊 Cached data matches: ${JSON.stringify(cachedResult2) === JSON.stringify(testResult)}`);
    }

    // Test 7: Cache statistics
    console.log('\n7️⃣ Testing cache statistics...');
    const stats = await foundationCache.getCacheStatistics();
    console.log(`   📈 Foundation sessions: ${stats.foundationSessions}`);
    console.log(`   📈 Cache entries: ${stats.totalCacheEntries}`);
    console.log(`   📈 Cache efficiency: ${(stats.cacheEfficiency * 100).toFixed(1)}%`);

    // Test 8: Session validation report
    console.log('\n8️⃣ Testing session validation report...');
    const validationReport = await foundationCache.validateFoundationSessions();
    console.log(`   📊 Total sessions: ${validationReport.total}`);
    console.log(`   ✅ Valid sessions: ${validationReport.valid}`);
    console.log(`   ❌ Invalid sessions: ${validationReport.invalid}`);
    console.log(`   ⚠️  Stale sessions: ${validationReport.stale}`);

    // Test 9: Cache maintenance
    console.log('\n9️⃣ Testing cache maintenance...');
    const maintenanceResult = await foundationCache.performMaintenance();
    console.log(`   🧹 Expired entries cleaned: ${maintenanceResult.expiredEntries}`);
    console.log(`   🧹 Orphaned entries cleaned: ${maintenanceResult.orphanedEntries}`);
    console.log(`   🧹 Invalid sessions cleaned: ${maintenanceResult.invalidSessions}`);
    console.log(`   🧹 Database compacted: ${maintenanceResult.compactedSize} bytes`);

    console.log('\n✅ All tests completed successfully!\n');

    // Display final statistics
    const finalStats = await foundationCache.getCacheStatistics();
    console.log('📊 Final Cache Statistics:');
    console.log(`   • Foundation Sessions: ${finalStats.foundationSessions}`);
    console.log(`   • Derived Sessions: ${finalStats.derivedSessions}`);
    console.log(`   • Total Cache Entries: ${finalStats.totalCacheEntries}`);
    console.log(`   • Total Tokens Saved: ${finalStats.totalTokensSaved}`);
    console.log(`   • Hit Rate: ${(finalStats.hitRate * 100).toFixed(1)}%`);
    console.log(`   • Cache Efficiency: ${(finalStats.cacheEfficiency * 100).toFixed(1)}%`);

    if (finalStats.topTemplates.length > 0) {
      console.log('   • Top Templates:');
      finalStats.topTemplates.slice(0, 3).forEach(template => {
        console.log(`     - ${template.templateId}: ${template.hits} hits, ${template.tokensSaved} tokens saved`);
      });
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    // Cleanup
    foundationCache.close();
    console.log('\n🧹 Cleaned up test resources');
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testFoundationCaching()
    .then(() => {
      console.log('\n🎉 Foundation caching test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Foundation caching test failed:', error);
      process.exit(1);
    });
}

export { testFoundationCaching };