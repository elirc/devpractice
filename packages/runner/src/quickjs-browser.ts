import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core';
import releaseSyncVariant from '@jitl/quickjs-wasmfile-release-sync';
// Vite resolves this to a real emitted asset URL served as application/wasm.
import wasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url';

/**
 * Browser QuickJS loader.
 *
 * `getQuickJS()` from `quickjs-emscripten` asks Emscripten to locate
 * `emscripten-module.wasm` relative to the *worker script* URL. Under Vite that
 * path is not an emitted asset, so the dev server's SPA fallback answers with
 * index.html and instantiation dies with:
 *
 *   wasm streaming compile failed: Incorrect response MIME type...
 *   expected magic word 00 61 73 6d, found 3c 21 64 6f   ("<!do")
 *
 * Pointing the variant at a Vite-resolved `?url` import fixes it: the bundler
 * emits the .wasm as an asset and serves it with the correct MIME type in both
 * dev and build. No new dependency — the variant package is already required by
 * `quickjs-emscripten` and is declared directly in this package.
 */
let modulePromise: Promise<QuickJSWASMModule> | undefined;

export function loadBrowserQuickJS(): Promise<QuickJSWASMModule> {
  if (!modulePromise) {
    const variant = newVariant(releaseSyncVariant, { wasmLocation: wasmUrl });
    modulePromise = newQuickJSWASMModuleFromVariant(variant);
  }
  return modulePromise;
}

/** Exposed for diagnostics: which URL the worker will fetch the WASM from. */
export const QUICKJS_WASM_URL = wasmUrl;
