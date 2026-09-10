#!/usr/bin/env node
/**
 * Copies solution/src over a throwaway copy of the starter and runs BOTH check
 * commands. The starter itself is never modified.
 */
import { cpSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const starter = resolve(here, '..');
const mission = resolve(starter, '..');
const solutionSrc = join(mission, 'solution', 'src');

if (!existsSync(solutionSrc)) {
  console.error('No solution/src directory found at ' + solutionSrc);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'm01-solution-'));
try {
  cpSync(starter, work, {
    recursive: true,
    filter: (src) => !src.includes('node_modules') && !src.includes(String.raw`\.git`),
  });
  // Reuse the starter's installed dependencies instead of installing again.
  const nm = join(starter, 'node_modules');
  if (!existsSync(nm)) {
    console.error('Run "npm install" in the starter first.');
    process.exit(1);
  }
  cpSync(solutionSrc, join(work, 'src'), { recursive: true });

  const run = (args) =>
    spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
      cwd: work,
      stdio: 'inherit',
      env: { ...process.env, NODE_PATH: nm },
    });

  console.log('\n--- baseline ---');
  const baseline = run(['vitest', 'run', 'tests/baseline.test.tsx']);
  console.log('\n--- mission ---');
  const missionRun = run(['vitest', 'run', 'tests/mission.test.tsx']);

  const ok = baseline.status === 0 && missionRun.status === 0;
  console.log('\nReference solution: ' + (ok ? 'PASSES both check commands' : 'FAILED'));
  process.exit(ok ? 0 : 1);
} finally {
  rmSync(work, { recursive: true, force: true });
}
