import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Prevent runaway tests from hammering disk
    testTimeout: 30000, // 30 second max per test
    hookTimeout: 10000, // 10 second max for setup/teardown
    teardownTimeout: 5000,
    // Disable watch mode by default (use test:ui explicitly)
    watch: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.d.ts']
    }
  }
});