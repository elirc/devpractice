/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // This project is often run on slow machines; user-event driven form
    // tests need more than the 5s default.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
