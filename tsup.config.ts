import { defineConfig } from 'tsup';

export default defineConfig([
  // Global MCP Server build (dom0 - orchestration only)
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
    // Ensure server binary is executable and copy hooks
    onSuccess: async () => {
      const { execSync } = await import('child_process');
      const fs = await import('fs');
      const path = await import('path');
      
      try {
        execSync('chmod +x dist/server/index.js', { stdio: 'ignore' });
        console.log('✅ Made server binary executable');
      } catch (error) {
        console.warn('⚠️  Failed to make server binary executable:', error);
      }
      
      // Copy hooks directory to dist with Unix line endings
      try {
        const srcHooksDir = path.resolve('src/hooks');
        const distHooksDir = path.resolve('dist/hooks');
        
        if (fs.existsSync(srcHooksDir)) {
          // Create dist hooks directory
          fs.mkdirSync(distHooksDir, { recursive: true });
          
          // Copy each hook file and fix line endings
          const hookFiles = fs.readdirSync(srcHooksDir);
          for (const file of hookFiles) {
            const srcFile = path.join(srcHooksDir, file);
            const destFile = path.join(distHooksDir, file);
            
            let content = fs.readFileSync(srcFile, 'utf8');
            // Ensure Unix line endings
            content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            
            fs.writeFileSync(destFile, content);
            fs.chmodSync(destFile, 0o755); // Make executable
          }
          
          console.log('✅ Copied hooks to dist with Unix line endings');
        }
      } catch (error) {
        console.warn('⚠️  Failed to copy hooks:', error);
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
  },
  // Talent MCP Server build (domU - coordination tools only)
  {
    entry: ['src/talent-server/index.ts'],
    outDir: 'dist/talent-server',
    format: ['esm'],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    minify: false,
    target: 'node18',
    platform: 'node',
    bundle: true,
    external: ['@lancedb/lancedb', 'better-sqlite3'],
    publicDir: false,
    treeshake: true,
    skipNodeModulesBundle: true,
    tsconfig: 'tsconfig.json',
    shims: false,
    cjsInterop: false,
    banner: {
      js: '#!/usr/bin/env node'
    },
    onSuccess: async () => {
      const { execSync } = await import('child_process');
      try {
        execSync('chmod +x dist/talent-server/index.js', { stdio: 'ignore' });
        console.log('✅ Made talent server binary executable');
      } catch (error) {
        console.warn('⚠️  Failed to make talent server binary executable:', error);
      }
    }
  }
]);