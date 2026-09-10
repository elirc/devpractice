import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // QuickJS WASM initialisation plus the TypeScript program build are slow on
    // a cold start; individual isolation checks stay well inside this.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
