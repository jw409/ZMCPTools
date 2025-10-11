import { defineConfig } from 'drizzle-kit';
import { join } from 'path';
import { StoragePathResolver } from './src/services/StoragePathResolver';

// Get project root - works in both development and production
const projectRoot = process.cwd();

// Use StoragePathResolver for proper dom0/domU isolation (fixes GitHub issue #6)
const storageConfig = StoragePathResolver.getStorageConfig({ preferLocal: true });
const dbPath = StoragePathResolver.getSQLitePath(storageConfig, 'claude_mcp_tools');

const config = defineConfig({
  schema: [
    // List individual schema files to avoid glob issues
    join(projectRoot, 'src', 'schemas', 'agents.ts'),
    join(projectRoot, 'src', 'schemas', 'communication.ts'),
    join(projectRoot, 'src', 'schemas', 'knowledge-graph.ts'),
    join(projectRoot, 'src', 'schemas', 'logs.ts'),
    join(projectRoot, 'src', 'schemas', 'memories.ts'),
    join(projectRoot, 'src', 'schemas', 'plans.ts'),
    join(projectRoot, 'src', 'schemas', 'scraping.ts'),
    join(projectRoot, 'src', 'schemas', 'tasks.ts'),
  ],
  out: join(StoragePathResolver.getBaseStoragePath(storageConfig), 'sqlite', 'migrations'),
  dialect: 'sqlite',
  dbCredentials: {
    url: dbPath,
  },
  verbose: true,
  strict: true,
});

export default config;