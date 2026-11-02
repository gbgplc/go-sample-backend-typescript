import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The Route Handler integration tests import lib/config, which resolves
    // its market/mode at module-load time from these — set globally so it's
    // in place before any test file's top-level imports run.
    env: {
      MARKET: 'northbank',
      GO_MODE: 'mock',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
