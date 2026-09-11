import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ContentPackage } from '@devpractice/contracts';
import { validateStructure } from '../src/validate.js';
import { loadConceptCatalog, type ConceptCatalog } from '../src/concepts.js';
import { verifyPackage } from '../src/verify.js';
import { buildInventory } from '../src/inventory.js';

/**
 * The validator is only worth having if its checks actually fire. Each invalid
 * fixture differs from the valid one by exactly ONE defect, so a check that
 * silently stopped working shows up as a specific failure here.
 *
 * `gate-harness.mjs` runs the same assertions without vitest, for bare
 * environments where the workspace is not linked.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const FIXTURES = join(ROOT, 'curriculum', 'fixtures');

let catalog: ConceptCatalog;

const loadFixture = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(join(FIXTURES, name), 'utf8')) as unknown;

async function parseFixture(name: string): Promise<ContentPackage> {
  const result = validateStructure(await loadFixture(name), catalog);
  if (!result.pkg) throw new Error(`${name} did not parse`);
  return result.pkg;
}

beforeAll(async () => {
  catalog = await loadConceptCatalog(join(ROOT, 'curriculum', 'concepts.json'));
});

describe('concept catalog', () => {
  it('covers chapters 1-12 with unique ids', () => {
    expect(catalog.concepts.length).toBeGreaterThanOrEqual(100);
    const ids = catalog.concepts.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the valid fixture', () => {
  it('passes every structural check', async () => {
    const { issues } = validateStructure(await loadFixture('valid-chapter.json'), catalog);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors.map((e) => `${e.code}@${e.path}`)).toEqual([]);
  });

  it('reports the expected inventory', async () => {
    const pkg = await parseFixture('valid-chapter.json');
    const inventory = buildInventory(pkg);
    expect(inventory).toMatchObject({
      tracks: 1,
      chapters: 1,
      lessons: 1,
      lessonExercises: 3,
      reviewCards: 2,
      assessments: 1,
      placementItems: 5,
    });
  });
});

describe('each structural check fires on its own fixture', () => {
  const cases: [string, string][] = [
    ['invalid-bad-reference.json', 'reference.missing'],
    ['invalid-duplicate-version.json', 'version.duplicate'],
    ['invalid-prerequisite-cycle.json', 'prerequisite.cycle'],
    ['invalid-unknown-field.json', 'field.unknown'],
    ['invalid-forbidden-field.json', 'field.forbidden'],
    ['invalid-unsafe-link.json', 'link.unsafe'],
    ['invalid-duplicate-hints.json', 'hint.duplicate'],
    ['invalid-copied-placement.json', 'placement.copied'],
    ['invalid-uncovered-objective.json', 'concept.uncovered-objective'],
    ['invalid-unknown-concept.json', 'concept.unknown'],
    ['invalid-weak-cases.json', 'grading.uniform-expectations'],
    // Reachability: the two checks that look BACKWARDS. Every other check here
    // walks references forwards, which is why both of these shipped broken.
    ['invalid-chapter-unlisted.json', 'reachability.chapter-unlisted'],
    ['invalid-mission-unclaimed.json', 'reachability.mission-unclaimed'],
  ];

  it.each(cases)('%s raises %s', async (fixture, code) => {
    const { issues } = validateStructure(await loadFixture(fixture), catalog);
    const hit = issues.find((i) => i.code === code && i.severity === 'error');
    expect(hit, `expected ${code}; got ${issues.map((i) => i.code).join(', ') || '(none)'}`).toBeDefined();
  });
});

describe('behavioural gate', () => {
  it('accepts the reference solution and rejects the starter', async () => {
    const pkg = await parseFixture('valid-chapter.json');
    const { report } = await verifyPackage(pkg, undefined, true);
    const check = report.checks.find((c) => c.exerciseId === 'js-arrays-filter-open');

    expect(check).toBeDefined();
    expect(check?.solutionPassed).toBe(true);
    expect(check?.starterFailsAsExpected).toBe(true);
  });

  it('rejects the three wrong implementations the specification names', async () => {
    const pkg = await parseFixture('valid-chapter.json');
    const { report } = await verifyPackage(pkg, undefined, true);
    const check = report.checks.find((c) => c.exerciseId === 'js-arrays-filter-open');

    // always-zero, count-all, and correct-but-mutates-the-input.
    expect(check?.mutantsRejected).toEqual(
      expect.arrayContaining(['constant-0', 'filter-accepts-all', 'mutates-input']),
    );
    expect(check?.mutantsAccepted).toEqual([]);
  });

  it('produces no errors for the valid fixture', async () => {
    const pkg = await parseFixture('valid-chapter.json');
    const { issues } = await verifyPackage(pkg, undefined, true);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('rejects a starter that already passes every case', async () => {
    const pkg = await parseFixture('invalid-always-passing-starter.json');
    const { issues } = await verifyPackage(pkg, undefined, true);
    expect(issues.some((i) => i.code === 'verify.starter-already-passes' && i.severity === 'error')).toBe(true);
  });

  it('rejects grading cases too weak to kill a constant implementation', async () => {
    const raw = await loadFixture('invalid-weak-cases.json');
    const structural = validateStructure(raw, catalog);
    const { issues } = await verifyPackage(structural.pkg!, undefined, true);

    const caughtStructurally = structural.issues.some((i) => i.code === 'grading.uniform-expectations');
    const caughtByMutant = issues.some((i) => i.code === 'verify.mutant-survived');
    expect(caughtStructurally || caughtByMutant).toBe(true);
  });
});
