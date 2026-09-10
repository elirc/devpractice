/**
 * Bundler-resolved asset imports. `?url` yields the emitted asset's URL, which
 * is how the browser worker locates the QuickJS .wasm binary.
 */
declare module '*?url' {
  const url: string;
  export default url;
}
