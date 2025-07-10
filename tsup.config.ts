import { defineConfig } from 'tsup';

export default defineConfig([
  // Server build (with shebang for npx usage, excludes native deps)
  {
    entry: ['src/index.ts'],
    outDir: 'dist/server',
    format: ['esm'],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    minify: false,
    target: 'node18',
    platform: 'node',
    bundle: true,
    external: ['@lancedb/lancedb', 'better-sqlite3'], // Mark native deps as external
    publicDir: false,
    treeshake: true,
    skipNodeModulesBundle: true, // Don't bundle node_modules due to native deps
    tsconfig: 'tsconfig.json',
    shims: false,
    cjsInterop: false,
    banner: {
      js: '#!/usr/bin/env node'
    },
    // Ensure server binary is executable
    onSuccess: async () => {
      const { execSync } = await import('child_process');
      try {
        execSync('chmod +x dist/server/index.js', { stdio: 'ignore' });
        console.log('✅ Made server binary executable');
      } catch (error) {
        console.warn('⚠️  Failed to make server binary executable:', error);
      }
    }
  },
  // CLI build (with shebang)
  {
    entry: ['src/cli/index.ts'],
    outDir: 'dist/cli',
    format: ['esm'],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    minify: false,
    target: 'node18',
    platform: 'node',
    bundle: true,
    external: [],
    publicDir: false,
    treeshake: true,
    skipNodeModulesBundle: true,
    tsconfig: 'tsconfig.json',
    shims: false,
    cjsInterop: false,
    banner: {
      js: '#!/usr/bin/env node'
    },
    // Ensure CLI binary is executable
    onSuccess: async () => {
      const { execSync } = await import('child_process');
      try {
        execSync('chmod +x dist/cli/index.js', { stdio: 'ignore' });
        console.log('✅ Made CLI binary executable');
      } catch (error) {
        console.warn('⚠️  Failed to make CLI binary executable:', error);
      }
    }
  }
]);