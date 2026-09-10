import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Learning-domain integration suite against a REAL disposable PostgreSQL.
 *
 * Kept separate from the foundation config only because the two suites are
 * owned by different workstreams; both share the same single-fork discipline
 * because each test truncates the shared schema.
 */
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(here, '..', '..'),
  test: {
    include: ['tests/learning/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
  },
});
