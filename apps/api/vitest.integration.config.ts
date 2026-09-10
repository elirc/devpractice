import { defineConfig } from 'vitest/config';

/**
 * Integration and acceptance tests against a REAL disposable PostgreSQL.
 *
 * Runs single-threaded: every test truncates the shared schema between cases,
 * so parallel files would race each other's fixtures.
 */
export default defineConfig({
  test: {
    include: ['tests/foundation/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // Argon2id at production cost plus real migrations needs a generous budget.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
  },
});
