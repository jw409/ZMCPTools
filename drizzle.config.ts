import { defineConfig } from 'drizzle-kit';
import { join } from 'path';

// Get project root - works in both development and production
const projectRoot = process.cwd();

// Use same database path as runtime (pathResolver.getDatabasePath())
// This ensures drizzle-kit operates on the same database as the application
const dbPath = join(projectRoot, 'var', 'db', 'zmcp_local.db');
const migrationsPath = join(projectRoot, 'drizzle');

const config = defineConfig({
  schema: join(projectRoot, 'src', 'schemas', '*.ts'),
  out: migrationsPath,
  dialect: 'sqlite',
  dbCredentials: {
    url: dbPath,
  },
  verbose: true,
  strict: true,
});

export default config;