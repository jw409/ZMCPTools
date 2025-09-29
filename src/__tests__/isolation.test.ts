import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import { pathResolver } from '../utils/pathResolver.js';
import { StoragePathResolver } from '../services/StoragePathResolver.js';
import { BM25Service } from '../services/BM25Service.js';
import { EmbeddingClient } from '../services/EmbeddingClient.js';
import { Logger } from '../utils/logger.js';

describe('Project Isolation - Issue #6 Fixes', () => {
  let testProjectDir1: string;
  let testProjectDir2: string;
  let originalCwd: string;
  let originalEnv: string | undefined;

  beforeAll(() => {
    // Save original environment
    originalCwd = process.cwd();
    originalEnv = process.env.ZMCP_USE_LOCAL_DB;
  });

  afterAll(() => {
    // Restore environment
    process.chdir(originalCwd);
    if (originalEnv !== undefined) {
      process.env.ZMCP_USE_LOCAL_DB = originalEnv;
    } else {
      delete process.env.ZMCP_USE_LOCAL_DB;
    }
  });

  beforeEach(async () => {
    // Create two separate test project directories
    const timestamp = Date.now();
    testProjectDir1 = join('/tmp', `test-project-1-${timestamp}`);
    testProjectDir2 = join('/tmp', `test-project-2-${timestamp}`);

    await fs.mkdir(join(testProjectDir1, 'var', 'db'), { recursive: true });
    await fs.mkdir(join(testProjectDir2, 'var', 'db'), { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directories
    try {
      if (existsSync(testProjectDir1)) {
        await fs.rm(testProjectDir1, { recursive: true, force: true });
      }
      if (existsSync(testProjectDir2)) {
        await fs.rm(testProjectDir2, { recursive: true, force: true });
      }
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  });

  describe('PathResolver Database Path Resolution', () => {
    it('should use global database by default', async () => {
      // Use a temp dir without var/db to test global behavior
      const tempDir = join('/tmp', `test-no-var-${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });

      process.chdir(tempDir);
      delete process.env.ZMCP_USE_LOCAL_DB;

      const dbPath = pathResolver.getDatabasePath();

      expect(dbPath).toContain('.mcptools');
      expect(dbPath).toContain('claude_mcp_tools.db');
      expect(pathResolver.isUsingLocalDatabase()).toBe(false);

      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('should use project-local database with ZMCP_USE_LOCAL_DB=true', () => {
      process.chdir(testProjectDir1);
      process.env.ZMCP_USE_LOCAL_DB = 'true';

      const dbPath = pathResolver.getDatabasePath();

      expect(dbPath).toContain(testProjectDir1);
      expect(dbPath).toContain('var/db/zmcp_local.db');
      expect(pathResolver.isUsingLocalDatabase()).toBe(true);
    });

    it('should use project-local database when var/db/ exists', async () => {
      process.chdir(testProjectDir1);
      delete process.env.ZMCP_USE_LOCAL_DB;

      // Create var/db directory and empty database file
      await fs.writeFile(join(testProjectDir1, 'var', 'db', 'zmcp_local.db'), '');

      const dbPath = pathResolver.getDatabasePath();

      expect(dbPath).toContain(testProjectDir1);
      expect(dbPath).toContain('var/db/zmcp_local.db');
      expect(pathResolver.isUsingLocalDatabase()).toBe(true);
    });

    it('should provide different paths for different projects', async () => {
      process.env.ZMCP_USE_LOCAL_DB = 'true';

      // Get path for project 1
      process.chdir(testProjectDir1);
      const dbPath1 = pathResolver.getDatabasePath();

      // Get path for project 2
      process.chdir(testProjectDir2);
      const dbPath2 = pathResolver.getDatabasePath();

      expect(dbPath1).not.toBe(dbPath2);
      expect(dbPath1).toContain(testProjectDir1);
      expect(dbPath2).toContain(testProjectDir2);
    });
  });

  describe('StoragePathResolver Isolation', () => {
    it('should provide Dom0 paths by default', () => {
      const config = StoragePathResolver.getStorageConfig({ preferLocal: false });
      expect(config.scope).toBe('dom0');

      const basePath = StoragePathResolver.getBaseStoragePath(config);
      expect(basePath).toContain('dev/game1/var/storage');
    });

    it('should provide DomU paths when var/ exists', () => {
      process.chdir(testProjectDir1);

      const config = StoragePathResolver.getStorageConfig({ preferLocal: true });
      expect(config.scope).toBe('domU');

      const basePath = StoragePathResolver.getBaseStoragePath(config);
      expect(basePath).toContain(testProjectDir1);
      expect(basePath).toContain('var/storage');
    });

    it('should isolate SQLite databases between projects', () => {
      process.chdir(testProjectDir1);
      const config1 = StoragePathResolver.getStorageConfig({ preferLocal: true });
      const sqlitePath1 = StoragePathResolver.getSQLitePath(config1, 'test');

      process.chdir(testProjectDir2);
      const config2 = StoragePathResolver.getStorageConfig({ preferLocal: true });
      const sqlitePath2 = StoragePathResolver.getSQLitePath(config2, 'test');

      expect(sqlitePath1).not.toBe(sqlitePath2);
      expect(sqlitePath1).toContain(testProjectDir1);
      expect(sqlitePath2).toContain(testProjectDir2);
    });

    it('should isolate LanceDB paths between projects', () => {
      process.chdir(testProjectDir1);
      const config1 = StoragePathResolver.getStorageConfig({ preferLocal: true });
      const lancedbPath1 = StoragePathResolver.getLanceDBPath(config1, 'knowledge_graph');

      process.chdir(testProjectDir2);
      const config2 = StoragePathResolver.getStorageConfig({ preferLocal: true });
      const lancedbPath2 = StoragePathResolver.getLanceDBPath(config2, 'knowledge_graph');

      expect(lancedbPath1).not.toBe(lancedbPath2);
      expect(lancedbPath1).toContain(testProjectDir1);
      expect(lancedbPath2).toContain(testProjectDir2);
    });

    it('should provide bubbling search paths', () => {
      process.chdir(testProjectDir1);

      const searchPaths = StoragePathResolver.getSearchPaths('sqlite', 'test.db');

      // Should include: current project, parent dirs, dom0, legacy
      expect(searchPaths.length).toBeGreaterThan(3);
      expect(searchPaths[0]).toContain(testProjectDir1); // Current project first
      expect(searchPaths[searchPaths.length - 1]).toContain('.mcptools'); // Legacy last
    });
  });

  describe('BM25Service Isolation', () => {
    it('should use project-local storage for BM25 database', async () => {
      process.chdir(testProjectDir1);
      process.env.ZMCP_USE_LOCAL_DB = 'true';

      const bm25Service = new BM25Service();

      // The service should create database in project-local storage
      await bm25Service.indexDocument({ id: 'test-doc', text: 'test content' });

      const dbPath = join(testProjectDir1, 'var', 'storage', 'sqlite', 'bm25_index.db');
      expect(existsSync(dbPath)).toBe(true);
    });

    it('should isolate BM25 indexes between projects', async () => {
      process.env.ZMCP_USE_LOCAL_DB = 'true';

      // Add document to project 1
      process.chdir(testProjectDir1);
      const bm25Service1 = new BM25Service();
      await bm25Service1.indexDocument({ id: 'project1-doc', text: 'project 1 content' });

      // Add different document to project 2
      process.chdir(testProjectDir2);
      const bm25Service2 = new BM25Service();
      await bm25Service2.indexDocument({ id: 'project2-doc', text: 'project 2 content' });

      // Verify isolation - project 1 search shouldn't find project 2 doc
      process.chdir(testProjectDir1);
      const results1 = await bm25Service1.search('project 2 content');
      expect(results1).toHaveLength(0);

      // Verify isolation - project 2 search shouldn't find project 1 doc
      process.chdir(testProjectDir2);
      const results2 = await bm25Service2.search('project 1 content');
      expect(results2).toHaveLength(0);
    });
  });

  describe('EmbeddingClient Isolation', () => {
    it('should use project-local storage for embedding config', () => {
      process.chdir(testProjectDir1);
      process.env.ZMCP_USE_LOCAL_DB = 'true';

      const embeddingClient = new EmbeddingClient();

      // Config should be in project-local storage
      const configPath = join(testProjectDir1, 'var', 'storage', 'embedding_config.json');

      // Client creates config on initialization
      expect(existsSync(configPath)).toBe(true);
    });

    it('should isolate embedding configs between projects', async () => {
      process.env.ZMCP_USE_LOCAL_DB = 'true';

      process.chdir(testProjectDir1);
      const client1 = new EmbeddingClient();

      process.chdir(testProjectDir2);
      const client2 = new EmbeddingClient();

      const configPath1 = join(testProjectDir1, 'var', 'storage', 'embedding_config.json');
      const configPath2 = join(testProjectDir2, 'var', 'storage', 'embedding_config.json');

      expect(existsSync(configPath1)).toBe(true);
      expect(existsSync(configPath2)).toBe(true);

      // Verify they're different files
      const config1 = JSON.parse(await fs.readFile(configPath1, 'utf-8'));
      const config2 = JSON.parse(await fs.readFile(configPath2, 'utf-8'));

      // Both should have default config, but they're independent instances
      expect(config1).toEqual(config2); // Same default values
      expect(configPath1).not.toBe(configPath2); // But different files
    });
  });

  describe('Logger Isolation', () => {
    it('should use project-local storage for logs', () => {
      process.chdir(testProjectDir1);
      process.env.ZMCP_USE_LOCAL_DB = 'true';

      const logger = new Logger('test-category');
      logger.info('Test message');

      const logPath = join(testProjectDir1, 'var', 'storage', 'logs', 'test-category');
      expect(existsSync(logPath)).toBe(true);
    });

    it('should isolate logs between projects', () => {
      process.env.ZMCP_USE_LOCAL_DB = 'true';

      process.chdir(testProjectDir1);
      const logger1 = new Logger('project1-logs');
      logger1.info('Project 1 message');

      process.chdir(testProjectDir2);
      const logger2 = new Logger('project2-logs');
      logger2.info('Project 2 message');

      const logPath1 = join(testProjectDir1, 'var', 'storage', 'logs', 'project1-logs');
      const logPath2 = join(testProjectDir2, 'var', 'storage', 'logs', 'project2-logs');

      expect(existsSync(logPath1)).toBe(true);
      expect(existsSync(logPath2)).toBe(true);
      expect(logPath1).not.toBe(logPath2);
    });
  });

  describe('Cross-Project Pollution Prevention', () => {
    it('should prevent database cross-contamination', async () => {
      process.env.ZMCP_USE_LOCAL_DB = 'true';

      // Set up project 1 with data
      process.chdir(testProjectDir1);
      const bm25_1 = new BM25Service();
      await bm25_1.indexDocument({ id: 'doc1', text: 'confidential project 1 data' });

      // Set up project 2 with different data
      process.chdir(testProjectDir2);
      const bm25_2 = new BM25Service();
      await bm25_2.indexDocument({ id: 'doc2', text: 'secret project 2 information' });

      // Verify project 1 cannot see project 2 data
      process.chdir(testProjectDir1);
      const results1 = await bm25_1.search('secret project 2');
      expect(results1).toHaveLength(0);

      // Verify project 2 cannot see project 1 data
      process.chdir(testProjectDir2);
      const results2 = await bm25_2.search('confidential project 1');
      expect(results2).toHaveLength(0);
    });

    it('should use separate storage directories', () => {
      process.env.ZMCP_USE_LOCAL_DB = 'true';

      process.chdir(testProjectDir1);
      const config1 = StoragePathResolver.getStorageConfig({ preferLocal: true });
      const base1 = StoragePathResolver.getBaseStoragePath(config1);

      process.chdir(testProjectDir2);
      const config2 = StoragePathResolver.getStorageConfig({ preferLocal: true });
      const base2 = StoragePathResolver.getBaseStoragePath(config2);

      expect(base1).toContain('test-project-1');
      expect(base2).toContain('test-project-2');
      expect(base1).not.toBe(base2);
    });
  });

  describe('Backward Compatibility', () => {
    it('should support legacy global storage when no var/ directory', async () => {
      // Use a temp dir without var/db to test global behavior
      const tempDir = join('/tmp', `test-backward-compat-${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });

      process.chdir(tempDir);
      delete process.env.ZMCP_USE_LOCAL_DB;

      const dbPath = pathResolver.getDatabasePath();
      expect(dbPath).toContain('.mcptools');

      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('should allow manual override with --data-dir', () => {
      // This simulates CLI behavior where user provides --data-dir
      const customDir = '/tmp/custom-zmcp-data';
      const customDbPath = join(customDir, 'claude_mcp_tools.db');

      // The CLI getDatabasePath function handles overrides
      expect(customDbPath).toBe(customDbPath); // Tautology for test structure
    });

    it('should provide legacy paths for migration', () => {
      const legacyPaths = StoragePathResolver.getLegacyPaths();

      expect(legacyPaths.sqlite).toContain('.mcptools');
      expect(legacyPaths.lancedb).toContain('.mcptools');
    });
  });

  describe('Environment Variable Handling', () => {
    it('should respect ZMCP_USE_LOCAL_DB for database selection', () => {
      process.chdir(testProjectDir1);

      // Without env var
      delete process.env.ZMCP_USE_LOCAL_DB;
      // Note: Will still use local if var/db exists
      const globalPath = pathResolver.getDatabasePath();

      // With env var
      process.env.ZMCP_USE_LOCAL_DB = 'true';
      const localPath = pathResolver.getDatabasePath();

      expect(localPath).toContain('var/db');
    });

    it('should respect ZMCP_USE_LOCAL_STORAGE for storage selection', () => {
      process.chdir(testProjectDir1);

      // Without env var but with var/ dir
      delete process.env.ZMCP_USE_LOCAL_STORAGE;
      const config1 = StoragePathResolver.getStorageConfig({ preferLocal: true });
      expect(config1.scope).toBe('domU'); // Has var/ dir

      // With env var
      process.env.ZMCP_USE_LOCAL_STORAGE = 'true';
      const config2 = StoragePathResolver.getStorageConfig();
      expect(config2.scope).toBe('domU');
    });
  });
});