import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The web app and the API are served from ONE origin in production (spec 5.1),
 * which keeps cookies host-only and avoids credentialed cross-origin requests.
 * In development the API is proxied so the browser still sees a single origin.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_ORIGIN ?? 'http://localhost:3001',
        changeOrigin: false,
      },
    },
  },
  /**
   * The practice runner worker dynamically imports the QuickJS WASM module and
   * the TypeScript compiler, so its bundle is code-split. Vite's default worker
   * format is `iife`, which cannot express code splitting and fails the build —
   * ES module workers can. Every browser we target supports them.
   */
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // The QuickJS WASM payload is large and inlining it would bloat the entry.
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        // Keep the heavy practice dependencies in their own chunks so the
        // dashboard bundle does not carry the editor or the interpreter.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('codemirror') || id.includes('@codemirror') || id.includes('@lezer')) {
              return 'editor';
            }
            if (id.includes('quickjs') || id.includes('typescript')) return 'runner';
            if (id.includes('react') || id.includes('scheduler')) return 'react';
            if (id.includes('@tanstack')) return 'query';
          }
          return undefined;
        },
      },
    },
  },
});
