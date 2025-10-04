import { defineConfig } from 'drizzle-kit';
import { join } from 'path';
import { homedir } from 'os';

// Get project root - works in both development and production
const projectRoot = process.cwd();

// Simplified: use global database path directly
const dbPath = join(homedir(), '.mcptools', 'data', 'claude_mcp_tools.db');

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
  out: join(homedir(), '.mcptools', 'data', 'sqlite', 'migrations'),
  dialect: 'sqlite',
  dbCredentials: {
    url: dbPath,
  },
  verbose: true,
  strict: true,
});

export default config;