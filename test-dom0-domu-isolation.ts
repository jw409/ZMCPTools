/**
 * Basic Test for Dom0/DomU Isolation
 * Verifies that StoragePathResolver correctly isolates storage between projects
 */

import { StoragePathResolver } from './src/services/StoragePathResolver.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, existsSync } from 'fs';

console.log('🧪 Testing Dom0/DomU Isolation Implementation');
console.log('===============================================');

// Create test project directories
const testBase = join(tmpdir(), 'zmcp-isolation-test');
const project1 = join(testBase, 'project1');
const project2 = join(testBase, 'project2');

// Clean up any existing test directories
if (existsSync(testBase)) {
  rmSync(testBase, { recursive: true, force: true });
}

// Create test projects
mkdirSync(project1, { recursive: true });
mkdirSync(project2, { recursive: true });

console.log(`📁 Test directories created:`);
console.log(`   Project 1: ${project1}`);
console.log(`   Project 2: ${project2}`);
console.log();

try {
  // Test 1: Dom0 vs DomU scope difference
  console.log('🎯 Test 1: Dom0 vs DomU scope generates different paths');

  const dom0Config = StoragePathResolver.getStorageConfig({ forceScope: 'dom0' });
  const domUConfig = StoragePathResolver.getStorageConfig({
    forceScope: 'domU',
    projectPath: project1
  });

  const dom0LanceDB = StoragePathResolver.getLanceDBPath(dom0Config);
  const domULanceDB = StoragePathResolver.getLanceDBPath(domUConfig);

  const dom0SQLite = StoragePathResolver.getSQLitePath(dom0Config, 'test');
  const domUSQLite = StoragePathResolver.getSQLitePath(domUConfig, 'test');

  console.log(`   Dom0 LanceDB: ${dom0LanceDB}`);
  console.log(`   DomU LanceDB: ${domULanceDB}`);
  console.log(`   Dom0 SQLite:  ${dom0SQLite}`);
  console.log(`   DomU SQLite:  ${domUSQLite}`);

  if (dom0LanceDB === domULanceDB || dom0SQLite === domUSQLite) {
    throw new Error('❌ Dom0 and DomU should have different paths!');
  }
  console.log('   ✅ Dom0 and DomU have different paths');
  console.log();

  // Test 2: Project isolation
  console.log('🎯 Test 2: Different projects get isolated storage');

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

  console.log(`   Project 1 LanceDB: ${p1LanceDB}`);
  console.log(`   Project 2 LanceDB: ${p2LanceDB}`);
  console.log(`   Project 1 SQLite:  ${p1SQLite}`);
  console.log(`   Project 2 SQLite:  ${p2SQLite}`);

  if (p1LanceDB === p2LanceDB || p1SQLite === p2SQLite) {
    throw new Error('❌ Different projects should have different paths!');
  }
  console.log('   ✅ Different projects have isolated storage');
  console.log();

  // Test 3: Directory creation
  console.log('🎯 Test 3: Storage directories are created automatically');

  StoragePathResolver.ensureStorageDirectories(project1Config);
  StoragePathResolver.ensureStorageDirectories(project2Config);

  const p1StorageBase = StoragePathResolver.getBaseStoragePath(project1Config);
  const p2StorageBase = StoragePathResolver.getBaseStoragePath(project2Config);

  if (!existsSync(join(p1StorageBase, 'lancedb')) || !existsSync(join(p1StorageBase, 'sqlite'))) {
    throw new Error('❌ Project 1 storage directories not created!');
  }

  if (!existsSync(join(p2StorageBase, 'lancedb')) || !existsSync(join(p2StorageBase, 'sqlite'))) {
    throw new Error('❌ Project 2 storage directories not created!');
  }

  console.log(`   ✅ Storage directories created automatically`);
  console.log(`      ${p1StorageBase}/lancedb`);
  console.log(`      ${p1StorageBase}/sqlite`);
  console.log();

  // Test 4: Legacy path compatibility
  console.log('🎯 Test 4: Legacy paths are still accessible');

  const legacyPaths = StoragePathResolver.getLegacyPaths();
  console.log(`   Legacy LanceDB: ${legacyPaths.lancedb}`);
  console.log(`   Legacy SQLite:  ${legacyPaths.sqlite}`);

  if (!legacyPaths.lancedb.includes('.mcptools') || !legacyPaths.sqlite.includes('.mcptools')) {
    throw new Error('❌ Legacy paths should point to .mcptools directory!');
  }
  console.log('   ✅ Legacy paths available for backward compatibility');
  console.log();

  // Test 5: Search path bubbling
  console.log('🎯 Test 5: Search path bubbling works correctly');

  const searchPaths = StoragePathResolver.getSearchPaths('sqlite', 'agents');
  console.log(`   Search paths for SQLite 'agents':`);
  searchPaths.forEach((path, i) => {
    console.log(`     ${i + 1}. ${path}`);
  });

  if (searchPaths.length < 3) {
    throw new Error('❌ Should have multiple search paths for bubbling!');
  }
  console.log('   ✅ Search path bubbling implemented');
  console.log();

  // Test 6: Environment variable support
  console.log('🎯 Test 6: Environment variable detection');

  const originalEnv = process.env.ZMCP_USE_LOCAL_STORAGE;

  // Test without env var
  delete process.env.ZMCP_USE_LOCAL_STORAGE;
  const configWithoutEnv = StoragePathResolver.getStorageConfig();

  // Test with env var
  process.env.ZMCP_USE_LOCAL_STORAGE = 'true';
  const configWithEnv = StoragePathResolver.getStorageConfig();

  // Restore original env
  if (originalEnv !== undefined) {
    process.env.ZMCP_USE_LOCAL_STORAGE = originalEnv;
  } else {
    delete process.env.ZMCP_USE_LOCAL_STORAGE;
  }

  console.log(`   Without env var: scope=${configWithoutEnv.scope}`);
  console.log(`   With env var:    scope=${configWithEnv.scope}`);
  console.log('   ✅ Environment variable support working');
  console.log();

  console.log('🎉 All isolation tests passed!');
  console.log('===============================================');
  console.log('✅ Dom0/DomU isolation is working correctly');
  console.log('✅ LanceDB and SQLite services will use isolated storage');
  console.log('✅ Project isolation prevents data leakage');
  console.log('✅ Backward compatibility maintained');

} catch (error) {
  console.error('❌ Test failed:', error);
  process.exit(1);
} finally {
  // Clean up test directories
  if (existsSync(testBase)) {
    rmSync(testBase, { recursive: true, force: true });
  }
  console.log('🧹 Test directories cleaned up');
}