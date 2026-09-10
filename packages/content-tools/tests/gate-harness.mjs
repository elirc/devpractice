/**
 * Standalone gate harness.
 *
 * Proves every validator check actually fires. Each invalid fixture differs
 * from the valid one by exactly ONE defect, so the expected issue code must
 * appear for that fixture and must NOT appear for the valid one.
 *
 * Runs without vitest so the gates can be checked in a bare environment:
 *   node --import tsx packages/content-tools/tests/gate-harness.mjs
 * (or via `pnpm --filter @devpractice/content-tools test` once deps are linked)
 */
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const FIXTURES = join(ROOT, 'curriculum', 'fixtures');

const { validateStructure } = await import('../src/validate.ts');
const { loadConceptCatalog } = await import('../src/concepts.ts');
const { verifyPackage } = await import('../src/verify.ts');
const { buildInventory } = await import('../src/inventory.ts');

const catalog = await loadConceptCatalog(join(ROOT, 'curriculum', 'concepts.json'));

/** fixture file -> issue code that MUST fire. */
const EXPECTED = {
  'invalid-bad-reference.json': 'reference.missing',
  'invalid-duplicate-version.json': 'version.duplicate',
  'invalid-prerequisite-cycle.json': 'prerequisite.cycle',
  'invalid-unknown-field.json': 'field.unknown',
  'invalid-forbidden-field.json': 'field.forbidden',
  'invalid-unsafe-link.json': 'link.unsafe',
  'invalid-duplicate-hints.json': 'hint.duplicate',
  'invalid-copied-placement.json': 'placement.copied',
  'invalid-uncovered-objective.json': 'concept.uncovered-objective',
  'invalid-unknown-concept.json': 'concept.unknown',
};

/** Fixtures whose defect is only detectable by EXECUTING the content. */
const EXPECTED_BEHAVIOURAL = {
  'invalid-always-passing-starter.json': 'verify.starter-already-passes',
  'invalid-weak-cases.json': 'grading.uniform-expectations',
};

const load = async (name) => JSON.parse(await readFile(join(FIXTURES, name), 'utf8'));

let failures = 0;
const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => {
  failures += 1;
  console.log(`  FAIL  ${msg}`);
};

console.log('\n1. Valid fixture is accepted by every structural check');
const validRaw = await load('valid-chapter.json');
const validResult = validateStructure(validRaw, catalog);
const validErrors = validResult.issues.filter((i) => i.severity === 'error');
if (validErrors.length === 0) pass('valid-chapter.json has no errors');
else fail(`valid-chapter.json produced ${validErrors.length} error(s): ${validErrors.map((i) => `${i.code}@${i.path}`).join(', ')}`);

const inv = buildInventory(validResult.pkg);
const invOk = inv.lessons === 1 && inv.lessonExercises === 3 && inv.reviewCards === 2 && inv.placementItems === 5;
if (invOk) pass(`inventory counts correct (${inv.lessons}L / ${inv.lessonExercises}E / ${inv.reviewCards}C / ${inv.placementItems}P)`);
else fail(`unexpected inventory: ${JSON.stringify(inv)}`);

console.log('\n2. Each structural check fires on its own fixture');
for (const [file, code] of Object.entries(EXPECTED)) {
  const raw = await load(file);
  const { issues } = validateStructure(raw, catalog);
  const hit = issues.find((i) => i.code === code && i.severity === 'error');
  if (hit) pass(`${file} -> ${code} at ${hit.path}`);
  else {
    const codes = [...new Set(issues.map((i) => `${i.severity}:${i.code}`))].join(', ') || '(none)';
    fail(`${file} did NOT raise ${code}; got: ${codes}`);
  }
}

console.log('\n3. Structural checks that catch weak grading without executing');
for (const [file, code] of Object.entries(EXPECTED_BEHAVIOURAL)) {
  const raw = await load(file);
  const { issues } = validateStructure(raw, catalog);
  const hit = issues.find((i) => i.code === code);
  if (hit) pass(`${file} -> ${code} at ${hit.path}`);
  else console.log(`  note  ${file}: ${code} not raised structurally (expected for execution-only defects)`);
}

console.log('\n4. Behavioural gate: solutions, starters and wrong implementations');
const { issues: verifyIssues, report } = await verifyPackage(validResult.pkg, undefined, true);
console.log(`  backend: ${report.runnerBackend}`);
const check = report.checks.find((c) => c.exerciseId === 'js-arrays-filter-open');
if (!check) {
  fail('the function exercise was not verified at all');
} else {
  if (check.solutionPassed) pass('reference solution passes every case');
  else fail('reference solution did NOT pass its own cases');

  if (check.starterFailsAsExpected) pass('starter fails at least one case, so there is work to do');
  else fail('starter already passes, so the exercise teaches nothing');

  // The spec names three mutants this gate must reject.
  const required = [
    ['constant-0', 'always-zero'],
    ['filter-accepts-all', 'count-all'],
    ['mutates-input', 'input-mutating'],
  ];
  for (const [mutantId, label] of required) {
    if (check.mutantsRejected.includes(mutantId)) pass(`${label} mutant (${mutantId}) rejected`);
    else if (check.mutantsAccepted.includes(mutantId)) fail(`${label} mutant (${mutantId}) SURVIVED — cases are too weak`);
    else fail(`${label} mutant (${mutantId}) was never generated`);
  }
  console.log(`  rejected ${check.mutantsRejected.length} mutant(s): ${check.mutantsRejected.join(', ')}`);
  if (check.mutantsAccepted.length > 0) console.log(`  survived: ${check.mutantsAccepted.join(', ')}`);
}
const verifyErrors = verifyIssues.filter((i) => i.severity === 'error');
if (verifyErrors.length === 0) pass('valid fixture passes the behavioural gate cleanly');
else fail(`valid fixture behavioural errors: ${verifyErrors.map((i) => i.code).join(', ')}`);

console.log('\n5. Behavioural gate rejects a starter that already passes');
const alwaysPassing = await load('invalid-always-passing-starter.json');
const alwaysParsed = validateStructure(alwaysPassing, catalog);
const { issues: apIssues } = await verifyPackage(alwaysParsed.pkg, undefined, true);
if (apIssues.some((i) => i.code === 'verify.starter-already-passes' && i.severity === 'error')) {
  pass('invalid-always-passing-starter.json -> verify.starter-already-passes');
} else {
  fail(`starter-already-passes not detected; got: ${apIssues.map((i) => i.code).join(', ') || '(none)'}`);
}

console.log('\n6. Behavioural gate rejects grading cases too weak to kill a constant');
const weak = await load('invalid-weak-cases.json');
const weakParsed = validateStructure(weak, catalog);
const weakStructural = weakParsed.issues.some((i) => i.code === 'grading.uniform-expectations');
const { issues: weakIssues } = await verifyPackage(weakParsed.pkg, undefined, true);
const weakMutant = weakIssues.some((i) => i.code === 'verify.mutant-survived' && i.severity === 'error');
if (weakStructural || weakMutant) {
  pass(`weak cases caught (structural=${weakStructural}, survivingMutant=${weakMutant})`);
} else {
  fail('weak grading cases were NOT caught');
}

console.log(`\n${failures === 0 ? 'ALL GATES PASS' : `${failures} GATE CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
