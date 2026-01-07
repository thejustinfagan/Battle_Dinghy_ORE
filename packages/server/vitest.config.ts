import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@battle-dinghy/core': path.resolve(__dirname, '../core/src'),
      // Mock native/external dependencies for tests
      '@solana/web3.js': path.resolve(__dirname, 'tests/__mocks__/solana-web3.ts'),
      'canvas': path.resolve(__dirname, 'tests/__mocks__/canvas.ts'),
      'twitter-api-v2': path.resolve(__dirname, 'tests/__mocks__/twitter-api-v2.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
  },
});
