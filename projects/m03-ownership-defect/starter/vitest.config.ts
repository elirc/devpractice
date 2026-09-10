import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Integration tests share one database, so run files serially.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
