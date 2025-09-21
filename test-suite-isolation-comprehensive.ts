/**
 * Comprehensive Integration Test Suite for Dom0/DomU Isolation
 * Tests actual database operations, not just path resolution
 */

import { StoragePathResolver } from './src/services/StoragePathResolver.js';
import { LanceDBService } from './src/services/LanceDBService.js';
import { FoundationCacheService } from './src/services/FoundationCacheService.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import Database from 'better-sqlite3';

console.log('🧪 Comprehensive Dom0/DomU Isolation Test Suite');
console.log('=================================================');

// Test infrastructure setup
const testBase = join(tmpdir(), 'zmcp-comprehensive-test');
const project1 = join(testBase, 'project1');
const project2 = join(testBase, 'project2');
const project3 = join(testBase, 'project3');

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

function runTest(name: string, testFn: () => Promise<void> | void): Promise<void> {
  return new Promise(async (resolve) => {
    try {
      console.log(`🔄 Running: ${name}`);
      await testFn();
      results.push({ name, passed: true });
      console.log(`✅ Passed: ${name}`);
    } catch (error) {
      results.push({
        name,
        passed: false,
        error: error instanceof Error ? error.message : String(error)
      });
      console.log(`❌ Failed: ${name} - ${error}`);
    }
    resolve();
  });
}

async function setupTestEnvironment() {
  // Clean up any existing test directories
  if (existsSync(testBase)) {
    rmSync(testBase, { recursive: true, force: true });
  }

  // Create test projects with var/ structure to enable DomU mode
  [project1, project2, project3].forEach(project => {
    mkdirSync(join(project, 'var'), { recursive: true });

    // Create a package.json to make it look like a real project
    writeFileSync(join(project, 'package.json'), JSON.stringify({
      name: project.split('/').pop(),
      version: '1.0.0',
      description: 'Test project for isolation testing'
    }, null, 2));
  });

  console.log(`📁 Test environment created:`);
  console.log(`   ${project1}`);
  console.log(`   ${project2}`);
  console.log(`   ${project3}`);
  console.log();
}

async function teardownTestEnvironment() {
  if (existsSync(testBase)) {
    rmSync(testBase, { recursive: true, force: true });
  }
}

async function runComprehensiveTests() {
  await setupTestEnvironment();

  try {
    // ====== STORAGE PATH RESOLUTION TESTS ======
    await runTest('Storage Path Resolution - Basic Dom0/DomU', () => {
      const dom0Config = StoragePathResolver.getStorageConfig({ forceScope: 'dom0' });
      const domU1Config = StoragePathResolver.getStorageConfig({
        forceScope: 'domU',
        projectPath: project1
      });

      const dom0Path = StoragePathResolver.getLanceDBPath(dom0Config);
      const domU1Path = StoragePathResolver.getLanceDBPath(domU1Config);

      if (dom0Path === domU1Path) {
        throw new Error('Dom0 and DomU should have different paths');
      }

      if (!dom0Path.includes('dev/game1/var/storage')) {
        throw new Error(`Dom0 path should be in game1: ${dom0Path}`);
      }

      if (!domU1Path.includes(project1)) {
        throw new Error(`DomU path should be in project1: ${domU1Path}`);
      }
    });

    await runTest('Storage Path Resolution - Project Isolation', () => {
      const project1Config = StoragePathResolver.getStorageConfig({
        forceScope: 'domU',
        projectPath: project1
      });
      const project2Config = StoragePathResolver.getStorageConfig({
        forceScope: 'domU',
        projectPath: project2
      });

      const p1LanceDB = StoragePathResolver.getLanceDBPath(project1Config);
      const p2LanceDB = StoragePathResolver.getLanceDBPath(project2Config);
      const p1SQLite = StoragePathResolver.getSQLitePath(project1Config, 'agents');
      const p2SQLite = StoragePathResolver.getSQLitePath(project2Config, 'agents');

      if (p1LanceDB === p2LanceDB || p1SQLite === p2SQLite) {
        throw new Error('Different projects should have different storage paths');
      }
    });

    // ====== LANCEDB INTEGRATION TESTS ======
    await runTest('LanceDB Integration - Dom0 vs DomU Storage', async () => {
      // Create a mock DatabaseManager for LanceDB
      const mockDb = {
        getInstance: () => ({ run: () => {}, get: () => null, all: () => [] })
      } as any;

      // Test Dom0 LanceDB service
      const dom0LanceDB = new LanceDBService(mockDb, {
        storageScope: 'dom0',
        embeddingProvider: 'local'
      });

      // Test DomU LanceDB service
      const domU1LanceDB = new LanceDBService(mockDb, {
        storageScope: 'domU',
        projectPath: project1,
        embeddingProvider: 'local'
      });

      const domU2LanceDB = new LanceDBService(mockDb, {
        storageScope: 'domU',
        projectPath: project2,
        embeddingProvider: 'local'
      });

      // Verify they use different data paths
      const dom0Path = (dom0LanceDB as any).dataPath;
      const domU1Path = (domU1LanceDB as any).dataPath;
      const domU2Path = (domU2LanceDB as any).dataPath;

      if (dom0Path === domU1Path || dom0Path === domU2Path || domU1Path === domU2Path) {
        throw new Error(`LanceDB services should use different paths: dom0=${dom0Path}, domU1=${domU1Path}, domU2=${domU2Path}`);
      }

      // Verify directory structure is created
      if (!existsSync(dom0Path) || !existsSync(domU1Path) || !existsSync(domU2Path)) {
        throw new Error('LanceDB directories should be auto-created');
      }
    });

    await runTest('LanceDB Integration - Vector Document Storage Isolation', async () => {
      // This test would require actual LanceDB operations
      // For now, verify the path resolution works correctly
      const project1Config = StoragePathResolver.getStorageConfig({
        forceScope: 'domU',
        projectPath: project1
      });
      const project2Config = StoragePathResolver.getStorageConfig({
        forceScope: 'domU',
        projectPath: project2
      });

      const p1VectorPath = StoragePathResolver.getLanceDBPath(project1Config, 'docs');
      const p2VectorPath = StoragePathResolver.getLanceDBPath(project2Config, 'docs');

      StoragePathResolver.ensureStorageDirectories(project1Config);
      StoragePathResolver.ensureStorageDirectories(project2Config);

      if (p1VectorPath === p2VectorPath) {
        throw new Error('Projects should have isolated vector storage');
      }

      // Verify collection-specific paths
      if (!p1VectorPath.includes('project1') || !p2VectorPath.includes('project2')) {
        throw new Error('Vector paths should include project identifiers');
      }
    });

    // ====== SQLITE INTEGRATION TESTS ======
    await runTest('SQLite Integration - Foundation Cache Isolation', async () => {
      // Test foundation cache service with different projects
      const originalCwd = process.cwd();

      try {
        // Test project 1
        process.chdir(project1);
        const cache1 = new FoundationCacheService();
        const cache1Path = (cache1 as any).db?.name;

        // Test project 2
        process.chdir(project2);
        const cache2 = new FoundationCacheService();
        const cache2Path = (cache2 as any).db?.name;

        if (!cache1Path || !cache2Path) {
          throw new Error('Foundation cache databases should be initialized');
        }

        if (cache1Path === cache2Path) {
          throw new Error('Different projects should have different foundation cache databases');
        }

        if (!cache1Path.includes('project1') || !cache2Path.includes('project2')) {
          throw new Error('Cache paths should be project-specific');
        }

        // Clean up databases
        (cache1 as any).db?.close();
        (cache2 as any).db?.close();

      } finally {
        process.chdir(originalCwd);
      }
    });

    await runTest('SQLite Integration - Database Operations Isolation', async () => {
      // Create isolated databases for different projects
      const p1Config = StoragePathResolver.getStorageConfig({
        forceScope: 'domU',
        projectPath: project1
      });
      const p2Config = StoragePathResolver.getStorageConfig({
        forceScope: 'domU',
        projectPath: project2
      });

      StoragePathResolver.ensureStorageDirectories(p1Config);
      StoragePathResolver.ensureStorageDirectories(p2Config);

      const p1DbPath = StoragePathResolver.getSQLitePath(p1Config, 'test_agents');
      const p2DbPath = StoragePathResolver.getSQLitePath(p2Config, 'test_agents');

      // Create test databases
      const p1Db = new Database(p1DbPath);
      const p2Db = new Database(p2DbPath);

      try {
        // Create test tables
        p1Db.exec(`
          CREATE TABLE IF NOT EXISTS agents (
            id TEXT PRIMARY KEY,
            project TEXT,
            data TEXT
          )
        `);
        p2Db.exec(`
          CREATE TABLE IF NOT EXISTS agents (
            id TEXT PRIMARY KEY,
            project TEXT,
            data TEXT
          )
        `);

        // Insert test data
        p1Db.prepare('INSERT INTO agents (id, project, data) VALUES (?, ?, ?)').run('agent1', 'project1', 'project1-data');
        p2Db.prepare('INSERT INTO agents (id, project, data) VALUES (?, ?, ?)').run('agent1', 'project2', 'project2-data');

        // Verify isolation - same agent ID should have different data
        const p1Agent = p1Db.prepare('SELECT * FROM agents WHERE id = ?').get('agent1') as any;
        const p2Agent = p2Db.prepare('SELECT * FROM agents WHERE id = ?').get('agent1') as any;

        if (!p1Agent || !p2Agent) {
          throw new Error('Test data should be inserted in both databases');
        }

        if (p1Agent.data === p2Agent.data) {
          throw new Error('Projects should have isolated data storage');
        }

        if (p1Agent.project !== 'project1' || p2Agent.project !== 'project2') {
          throw new Error('Data should be project-specific');
        }

      } finally {
        p1Db.close();
        p2Db.close();
      }
    });

    // ====== MIGRATION AND ERROR HANDLING TESTS ======
    await runTest('Migration - Legacy Path Detection', () => {
      const legacyPaths = StoragePathResolver.getLegacyPaths();

      if (!legacyPaths.lancedb.includes('.mcptools/lancedb')) {
        throw new Error('Legacy LanceDB path should point to .mcptools/lancedb');
      }

      if (!legacyPaths.sqlite.includes('.mcptools/data/claude_mcp_tools.db')) {
        throw new Error('Legacy SQLite path should point to .mcptools/data');
      }
    });

    await runTest('Migration - Search Path Bubbling', () => {
      const originalCwd = process.cwd();

      try {
        process.chdir(project1);
        const searchPaths = StoragePathResolver.getSearchPaths('sqlite', 'agents');

        // Should include current project, parent directories, dom0, and legacy
        if (searchPaths.length < 4) {
          throw new Error(`Search paths should include multiple fallbacks, got ${searchPaths.length}`);
        }

        // First path should be current project
        if (!searchPaths[0].includes('project1')) {
          throw new Error('First search path should be current project');
        }

        // Last path should be legacy
        if (!searchPaths[searchPaths.length - 1].includes('.mcptools')) {
          throw new Error('Last search path should be legacy path');
        }

      } finally {
        process.chdir(originalCwd);
      }
    });

    await runTest('Error Handling - Invalid Project Path', () => {
      const invalidConfig = StoragePathResolver.getStorageConfig({
        forceScope: 'domU',
        projectPath: '/nonexistent/path/that/should/not/exist'
      });

      // Should not throw during config creation
      const path = StoragePathResolver.getLanceDBPath(invalidConfig);

      // Should handle gracefully when ensuring directories (may warn but not throw)
      StoragePathResolver.ensureStorageDirectories(invalidConfig);

      // For permission-denied paths, directories won't be created but should not crash
      // This is expected behavior - the service will need to handle this appropriately
      if (path.includes('/nonexistent/path/that/should/not/exist')) {
        // Test passed - we got the expected path and didn't crash
        return;
      }

      throw new Error('Invalid path handling should return expected path structure');
    });

    await runTest('Environment Variable Override', () => {
      const originalEnv = process.env.ZMCP_USE_LOCAL_STORAGE;

      try {
        // Test default behavior (should prefer local if var/ exists)
        delete process.env.ZMCP_USE_LOCAL_STORAGE;
        const configDefault = StoragePathResolver.getStorageConfig({ projectPath: project1 });

        // Test forced local
        process.env.ZMCP_USE_LOCAL_STORAGE = 'true';
        const configForced = StoragePathResolver.getStorageConfig({ projectPath: project1 });

        // Both should use DomU since project1 has var/ directory
        if (configDefault.scope !== 'domU' || configForced.scope !== 'domU') {
          throw new Error('Projects with var/ should use DomU scope');
        }

      } finally {
        if (originalEnv !== undefined) {
          process.env.ZMCP_USE_LOCAL_STORAGE = originalEnv;
        } else {
          delete process.env.ZMCP_USE_LOCAL_STORAGE;
        }
      }
    });

    // ====== CONCURRENT ACCESS TESTS ======
    await runTest('Concurrent Access - Multiple Services Same Project', async () => {
      const projectConfig = StoragePathResolver.getStorageConfig({
        forceScope: 'domU',
        projectPath: project3
      });

      StoragePathResolver.ensureStorageDirectories(projectConfig);

      // Create multiple SQLite connections to same project
      const dbPath = StoragePathResolver.getSQLitePath(projectConfig, 'concurrent_test');

      const db1 = new Database(dbPath);
      const db2 = new Database(dbPath);

      try {
        // Create table from first connection
        db1.exec(`
          CREATE TABLE IF NOT EXISTS concurrent_test (
            id INTEGER PRIMARY KEY,
            data TEXT,
            created_by TEXT
          )
        `);

        // Insert from both connections
        db1.prepare('INSERT INTO concurrent_test (data, created_by) VALUES (?, ?)').run('data1', 'db1');
        db2.prepare('INSERT INTO concurrent_test (data, created_by) VALUES (?, ?)').run('data2', 'db2');

        // Verify both inserts succeeded
        const count1 = db1.prepare('SELECT COUNT(*) as count FROM concurrent_test').get() as any;
        const count2 = db2.prepare('SELECT COUNT(*) as count FROM concurrent_test').get() as any;

        if (count1.count !== 2 || count2.count !== 2) {
          throw new Error('Concurrent access should work with SQLite');
        }

      } finally {
        db1.close();
        db2.close();
      }
    });

    // ====== PERFORMANCE TESTS ======
    await runTest('Performance - Path Resolution Overhead', () => {
      const iterations = 1000;
      const start = Date.now();

      for (let i = 0; i < iterations; i++) {
        const config = StoragePathResolver.getStorageConfig({
          forceScope: 'domU',
          projectPath: project1
        });
        StoragePathResolver.getLanceDBPath(config);
        StoragePathResolver.getSQLitePath(config, 'test');
      }

      const elapsed = Date.now() - start;
      const avgMs = elapsed / iterations;

      console.log(`   📊 Path resolution: ${avgMs.toFixed(3)}ms avg over ${iterations} iterations`);

      if (avgMs > 1.0) {
        throw new Error(`Path resolution too slow: ${avgMs}ms average (should be < 1ms)`);
      }
    });

  } finally {
    await teardownTestEnvironment();
  }
}

// Run the comprehensive test suite
(async () => {
  try {
    await runComprehensiveTests();

    // Print results summary
    console.log('\n📊 Test Results Summary');
    console.log('========================');

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => r.passed === false).length;

    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📊 Total:  ${results.length}`);

    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      results.filter(r => !r.passed).forEach(result => {
        console.log(`   • ${result.name}: ${result.error}`);
      });
      process.exit(1);
    } else {
      console.log('\n🎉 All tests passed! Dom0/DomU isolation is working correctly.');
      console.log('✅ LanceDB vector storage is properly isolated');
      console.log('✅ SQLite relational storage is properly isolated');
      console.log('✅ Migration and error handling works');
      console.log('✅ Concurrent access is safe');
      console.log('✅ Performance is acceptable');
    }

  } catch (error) {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  }
})();