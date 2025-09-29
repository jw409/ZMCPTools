import { defineConfig } from 'drizzle-kit';
import { join } from 'path';
import { homedir } from 'os';
import { StoragePathResolver } from './src/services/StoragePathResolver.js';

// Get project root - works in both development and production
const projectRoot = process.cwd();

// Get storage configuration for Dom0/DomU isolation
const storageConfig = StoragePathResolver.getStorageConfig({
  preferLocal: true,
  projectPath: projectRoot
});

// Ensure storage directories exist
StoragePathResolver.ensureStorageDirectories(storageConfig);

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
    // Use Dom0/DomU isolated storage path
    url: StoragePathResolver.getSQLitePath(storageConfig, 'claude_mcp_tools'),
  },
  verbose: true,
  strict: true,
});

export default config;