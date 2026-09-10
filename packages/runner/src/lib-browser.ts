import { DEFAULT_LIB_FILE_NAME, libProviderFromMap, type LibProvider } from './ts-compile.js';

/**
 * Browser lib.d.ts provider.
 *
 * The bundle is a generated module imported lazily, so the ~1 MB of standard
 * declarations is fetched only when a learner opens a TypeScript exercise and
 * never appears in the initial bundle.
 */
let cached: LibProvider | undefined;

export async function loadBrowserLibProvider(): Promise<LibProvider> {
  if (cached) return cached;
  try {
    const module = await import('./generated/lib-bundle.js');
    cached = libProviderFromMap(module.LIB_BUNDLE);
    return cached;
  } catch (error) {
    throw new Error(
      'TypeScript standard declarations are not bundled. Run ' +
        '"pnpm --filter @devpractice/runner libs:generate" and rebuild. ' +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

export { DEFAULT_LIB_FILE_NAME };
