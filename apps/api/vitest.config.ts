import { defineConfig } from 'vitest/config';

/**
 * Unit tests: pure business rules with no database.
 * The database-backed acceptance suite lives in vitest.integration.config.ts.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    environment: 'node',
    globals: false,
    passWithNoTests: true,
  },
});
