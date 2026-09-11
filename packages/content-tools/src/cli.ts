#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConceptCatalog } from './concepts.js';
import { assembleSnapshot, checksumOf, findOrphanChapterFiles, loadManifest } from './assemble.js';
import { validateStructure } from './validate.js';
import { verifyPackage, loadSidecar } from './verify.js';
import { buildInventory, checkInventoryAgainstTarget, RELEASE_TARGETS } from './inventory.js';
import { checksumAsset } from './asset-checksum.js';
import type { Issue, ValidationReport } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const DEFAULT_CURRICULUM = join(REPO_ROOT, 'curriculum');

interface CliOptions {
  curriculum: string;
  manifestFile: string | undefined;
  target: string | undefined;
  out: string | undefined;
  packageFile: string | undefined;
  skipVerify: boolean;
  fallbackRunner: boolean;
  json: boolean;
}

function formatIssue(issue: Issue): string {
  const marker = issue.severity === 'error' ? 'ERROR' : 'warn ';
  const item = issue.itemId ? ` [${issue.itemId}]` : '';
  return `  ${marker} ${issue.code}${item}\n        at ${issue.path}\n        ${issue.message}`;
}

function printReport(report: ValidationReport, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const errors = report.issues.filter((i) => i.severity === 'error');
  const warnings = report.issues.filter((i) => i.severity === 'warning');

  process.stdout.write(`\nPackage ${report.packageId}@${report.packageVersion}\n`);
  const inv = report.inventory;
  process.stdout.write(
    `\nInventory\n` +
      `  tracks ${inv.tracks}  chapters ${inv.chapters}  lessons ${inv.lessons}\n` +
      `  lesson exercises ${inv.lessonExercises}  review cards ${inv.reviewCards}\n` +
      `  assessments ${inv.assessments}  placement items ${inv.placementItems}  missions ${inv.missions}\n` +
      `  diversity: runnable ${inv.diversity.runnableFunction}, debugging/review ${inv.diversity.debuggingOrCodeReview}, ` +
      `rubric ${inv.diversity.explanationWithRubric}, choice ${inv.diversity.choice}, ` +
      `predict ${inv.diversity.predictOutput}, local ${inv.diversity.localProject}\n`,
  );

  if (report.verification) {
    const { runnerBackend, checks } = report.verification;
    const rejected = checks.reduce((sum, c) => sum + c.mutantsRejected.length, 0);
    const accepted = checks.reduce((sum, c) => sum + c.mutantsAccepted.length, 0);
    process.stdout.write(
      `\nSolution verification (backend: ${runnerBackend})\n` +
        `  exercises checked ${checks.length}\n` +
        `  solutions passing ${checks.filter((c) => c.solutionPassed).length}/${checks.length}\n` +
        `  starters failing as expected ${checks.filter((c) => c.starterFailsAsExpected).length}/${checks.length}\n` +
        `  wrong implementations rejected ${rejected}, wrongly accepted ${accepted}\n`,
    );
  }

  if (warnings.length > 0) {
    process.stdout.write(`\n${warnings.length} warning(s):\n${warnings.map(formatIssue).join('\n')}\n`);
  }
  if (errors.length > 0) {
    process.stdout.write(`\n${errors.length} error(s):\n${errors.map(formatIssue).join('\n')}\n`);
  }
  process.stdout.write(report.ok ? '\nOK\n' : '\nFAILED\n');
}

async function loadPackageRaw(
  options: CliOptions,
): Promise<{ raw: unknown; checksum: string }> {
  if (options.packageFile) {
    const raw: unknown = JSON.parse(await readFile(options.packageFile, 'utf8'));
    return { raw, checksum: checksumOf(raw) };
  }
  const manifest = await loadManifest(options.curriculum, options.manifestFile);
  const orphans = await findOrphanChapterFiles(options.curriculum, manifest);
  if (orphans.length > 0) {
    process.stderr.write(
      `\nNote: these chapter files exist but are not listed in this release manifest, so they are NOT in the snapshot:\n` +
        orphans.map((o) => `  ${o}`).join('\n') +
        `\n`,
    );
  }
  const assembled = await assembleSnapshot(options.curriculum, manifest);
  return { raw: assembled.raw, checksum: assembled.checksum };
}

async function runValidate(options: CliOptions): Promise<number> {
  const catalog = await loadConceptCatalog(join(options.curriculum, 'concepts.json'));
  const { raw } = await loadPackageRaw(options);

  const structural = validateStructure(raw, catalog);
  const issues: Issue[] = [...structural.issues];

  if (!structural.pkg) {
    printReport(
      {
        ok: false,
        packageId: '(unparsed)',
        packageVersion: '(unparsed)',
        issues,
        inventory: buildInventory({ items: [] } as never),
      },
      options.json,
    );
    return 1;
  }

  const pkg = structural.pkg;
  const inventory = buildInventory(pkg);

  if (options.target) {
    const target = RELEASE_TARGETS[options.target];
    if (!target) throw new Error(`Unknown release target '${options.target}'`);
    issues.push(...checkInventoryAgainstTarget(inventory, target));
  }

  let verification;
  if (!options.skipVerify) {
    const sidecar = await loadSidecar(options.curriculum);
    const result = await verifyPackage(pkg, sidecar, options.fallbackRunner);
    issues.push(...result.issues);
    verification = result.report;
  }

  const report: ValidationReport = {
    ok: !issues.some((i) => i.severity === 'error'),
    packageId: pkg.packageId,
    packageVersion: pkg.packageVersion,
    issues,
    inventory,
    ...(verification ? { verification } : {}),
  };
  printReport(report, options.json);
  return report.ok ? 0 : 1;
}

async function runBuild(options: CliOptions): Promise<number> {
  const code = await runValidate(options);
  if (code !== 0) {
    process.stderr.write('\nBuild aborted: validation failed. No package was written.\n');
    return code;
  }
  const { raw, checksum } = await loadPackageRaw(options);
  const pkg = raw as { packageId: string; packageVersion: string };
  const out =
    options.out ?? join(REPO_ROOT, 'curriculum', 'dist', `${pkg.packageId}-${pkg.packageVersion}.json`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  process.stdout.write(`\nWrote ${out}\n  checksum ${checksum}\n`);
  return 0;
}

/**
 * Print the checksum every asset in the manifest should carry, computed from
 * what is on disk. It reports rather than rewrites: a manifest is authored, and
 * a tool that silently re-stamped a checksum would make a changed bundle look
 * unchanged in review.
 */
async function runAssets(options: CliOptions): Promise<number> {
  const manifest = await loadManifest(options.curriculum, options.manifestFile);
  const repoRoot = resolve(options.curriculum, '..');
  let mismatched = 0;

  for (const asset of manifest.assets) {
    const directory = join(repoRoot, asset.path);
    if (!existsSync(directory)) {
      process.stdout.write(`  MISSING  ${asset.id}
           no directory at ${directory}
`);
      mismatched += 1;
      continue;
    }
    const { checksum, files } = await checksumAsset(directory);
    const agrees = checksum === asset.checksum;
    if (!agrees) mismatched += 1;
    process.stdout.write(
      `  ${agrees ? 'OK      ' : 'DIFFERS '} ${asset.id}  (${files.length} files)
` +
        `           on disk  ${checksum}
` +
        (agrees ? '' : `           manifest ${asset.checksum}
`),
    );
  }

  process.stdout.write(
    mismatched === 0
      ? `
All ${manifest.assets.length} asset checksum(s) match the files on disk.
`
      : `
${mismatched} of ${manifest.assets.length} asset checksum(s) do not match. Update the manifest deliberately.
`,
  );
  return mismatched === 0 ? 0 : 1;
}

async function runInventory(options: CliOptions): Promise<number> {
  const { raw } = await loadPackageRaw(options);
  const catalog = await loadConceptCatalog(join(options.curriculum, 'concepts.json'));
  const structural = validateStructure(raw, catalog);
  if (!structural.pkg) {
    process.stderr.write('Package does not parse; run validate for details.\n');
    return 1;
  }
  const inventory = buildInventory(structural.pkg);
  process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
  return 0;
}

function usage(): void {
  process.stdout.write(
    `dp-content <command> [options]\n\n` +
      `Commands\n` +
      `  validate    assemble the snapshot and run every content gate\n` +
      `  build       validate, then write the publishable snapshot package\n` +
      `  inventory   print release counts as JSON\n\n` +
      `Options\n` +
      `  --curriculum <dir>   curriculum directory (default: ./curriculum)\n` +
      `  --package <file>     validate one already-assembled package instead\n` +
      `  --target <v1|v2|v3>  also check the release inventory minimums\n` +
      `  --out <file>         output path for build\n` +
      `  --skip-verify        structural checks only (no solution execution)\n` +
      `  --fallback-runner    force the node:vm backend instead of QuickJS\n` +
      `  --json               machine-readable report\n`,
  );
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      curriculum: { type: 'string' },
      package: { type: 'string' },
      manifest: { type: 'string' },
      target: { type: 'string' },
      out: { type: 'string' },
      'skip-verify': { type: 'boolean', default: false },
      'fallback-runner': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  const command = positionals[0];
  if (values.help || !command) {
    usage();
    return command ? 0 : 1;
  }

  const options: CliOptions = {
    curriculum: values.curriculum ? resolve(values.curriculum) : DEFAULT_CURRICULUM,
    manifestFile: values.manifest,
    target: values.target,
    out: values.out,
    packageFile: values.package ? resolve(values.package) : undefined,
    skipVerify: values['skip-verify'] ?? false,
    fallbackRunner: values['fallback-runner'] ?? false,
    json: values.json ?? false,
  };

  if (!options.packageFile && !existsSync(options.curriculum)) {
    process.stderr.write(`Curriculum directory not found: ${options.curriculum}\n`);
    return 1;
  }

  switch (command) {
    case 'validate':
      return runValidate(options);
    case 'build':
      return runBuild(options);
    case 'inventory':
      return runInventory(options);
    case 'assets':
      return runAssets(options);
    default:
      process.stderr.write(`Unknown command '${command}'\n`);
      usage();
      return 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (invokedDirectly || process.env.DP_CONTENT_CLI === '1') {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
