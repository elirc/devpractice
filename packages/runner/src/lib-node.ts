import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DEFAULT_LIB_FILE_NAME,
  ES2020_LIB_FILES,
  type LibProvider,
} from './ts-compile.js';

/**
 * Node-side lib.d.ts provider, reading the pinned TypeScript package from disk.
 * Used by the content CLI and by tests so authored solutions are verified with
 * exactly the same semantic checking the browser applies.
 */
export function createNodeLibProvider(): LibProvider {
  const require = createRequire(import.meta.url);
  const tsEntry = require.resolve('typescript');
  const libDir = dirname(tsEntry);
  const cache = new Map<string, string | undefined>();

  return {
    defaultLibFileName: DEFAULT_LIB_FILE_NAME,
    read(fileName) {
      const base = fileName.replace(/^.*[\\/]/, '');
      if (cache.has(base)) return cache.get(base);
      let text: string | undefined;
      try {
        text = readFileSync(join(libDir, base), 'utf8');
      } catch {
        text = undefined;
      }
      cache.set(base, text);
      return text;
    },
  };
}

/** Names the generator bundles for the browser. */
export const BROWSER_LIB_FILE_NAMES = ES2020_LIB_FILES;
