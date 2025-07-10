import { defineConfig } from 'drizzle-kit';
import { join } from 'path';
import { homedir } from 'os';

// Get project root - works in both development and production
const projectRoot = process.cwd();

const config = defineConfig({
  schema: [
    // List individual schema files to avoid glob issues
    join(projectRoot, 'src', 'schemas', 'agents.ts'),
    join(projectRoot, 'src', 'schemas', 'communication.ts'),
    join(projectRoot, 'src', 'schemas', 'knowledge-graph.ts'),
    join(projectRoot, 'src', 'schemas', 'logs.ts'),
    join(projectRoot, 'src', 'schemas', 'memories.ts'),
    join(projectRoot, 'src', 'schemas', 'scraping.ts'),
    join(projectRoot, 'src', 'schemas', 'tasks.ts'),
  ],
  out: join(projectRoot, 'migrations'),  // Store migrations in tool directory
  dialect: 'sqlite',
  dbCredentials: {
    // Use consistent ~/.mcptools/data directory
    url: join(homedir(), '.mcptools', 'data', 'claude_mcp_tools.db'),
  },
  verbose: true,
  strict: true,
});

export default config;