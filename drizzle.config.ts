import { defineConfig } from 'drizzle-kit';
import { join } from 'path';
import { homedir } from 'os';

export default defineConfig({
  schema: './dist/schemas/index.js',
  out: './migrations',  // Store migrations in project directory for packaging
  dialect: 'sqlite',
  dbCredentials: {
    url: join(homedir(), '.mcptools', 'data', 'claude_mcp_tools.db'),
  },
  verbose: true,
  strict: true,
});