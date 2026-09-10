/**
 * Generates the browser lib.d.ts bundle used for TypeScript semantic checking.
 *
 * The bundle is emitted as a lazily-imported module so the compiler payload
 * never lands in the initial dashboard bundle (spec 14.3).
 *
 * Self-contained on purpose: it runs under `node --experimental-strip-types`,
 * which does not rewrite .js specifiers to .ts, so it imports nothing local.
 *
 * Run:  pnpm --filter @devpractice/runner libs:generate
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const libDir = dirname(require.resolve('typescript'));
const here = dirname(fileURLToPath(import.meta.url));
const outJs = resolve(here, '../src/generated/lib-bundle.js');
const outDts = resolve(here, '../src/generated/lib-bundle.d.ts');

/**
 * ES5 + ES2015..ES2020 + decorators, matching COMPILER_OPTIONS.target.
 * DOM, WebWorker, ScriptHost and *.full.d.ts are deliberately excluded: the
 * interpreter has no DOM, so exercises must not type-check against one.
 */
const INCLUDE = /^lib\.(es5|es(20(1[5-9]|20))(\..+)?|decorators(\.legacy)?)\.d\.ts$/;

const names = readdirSync(libDir)
  .filter((name) => INCLUDE.test(name) && !name.includes('.full.'))
  .sort();

const entries: string[] = [];
let totalBytes = 0;

for (const name of names) {
  const text = readFileSync(join(libDir, name), 'utf8');
  totalBytes += Buffer.byteLength(text, 'utf8');
  entries.push(`  ${JSON.stringify(name)}: ${JSON.stringify(text)},`);
}

if (names.length === 0) {
  console.error(`No lib files matched in ${libDir}`);
  process.exit(1);
}

const version = (require('typescript/package.json') as { version: string }).version;
const banner =
  `/* GENERATED FILE - do not edit. Run: pnpm --filter @devpractice/runner libs:generate */\n` +
  `/* Source: typescript ${version} */\n`;

mkdirSync(dirname(outJs), { recursive: true });

// Emitted as .js plus a small .d.ts: tsc then reads only the declaration, so a
// ~430 KB data module does not slow every typecheck to a crawl.
writeFileSync(outJs, `${banner}export const LIB_BUNDLE = {\n${entries.join('\n')}\n};\n`, 'utf8');
writeFileSync(outDts, `${banner}export declare const LIB_BUNDLE: Record<string, string>;\n`, 'utf8');

console.log(`wrote ${outJs}\n  files: ${names.length}\n  source bytes: ${totalBytes}`);
