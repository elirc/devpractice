import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { ContentPackage, ExerciseItem } from '@devpractice/contracts';
import { buildRequest, resolveRunner, type SolutionRunner } from './runner-adapter.js';
import { generateMutants, type MutantSpec } from './mutants.js';
import { err, warn, type Issue, type SolutionCheck, type VerificationReport } from './types.js';

/**
 * Behavioural gate: the reference solution must pass, the starter must fail,
 * and plausible wrong implementations must be rejected.
 */

const sidecarSchema = z
  .object({
    /**
     * Exercises whose starter is legitimately already correct — an explicit
     * read-only worked example. Every entry needs a reason (spec §10.4).
     */
    starterExemptions: z.record(z.string().min(10)).default({}),
    /** Extra author-written wrong implementations, keyed by exercise id. */
    declaredMutants: z
      .record(
        z.array(
          z.object({
            id: z.string().min(1),
            source: z.string().min(1),
            rationale: z.string().min(1),
          }),
        ),
      )
      .default({}),
  })
  .strict();

export type VerificationSidecar = z.infer<typeof sidecarSchema>;

const EMPTY_SIDECAR: VerificationSidecar = { starterExemptions: {}, declaredMutants: {} };

export async function loadSidecar(curriculumDir: string): Promise<VerificationSidecar> {
  const path = join(curriculumDir, 'verification.json');
  if (!existsSync(path)) return EMPTY_SIDECAR;
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
  const parsed = sidecarSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `${path} is invalid:\n  ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ')}`,
    );
  }
  return parsed.data;
}

async function runSource(
  runner: SolutionRunner,
  exercise: ExerciseItem,
  source: string,
): Promise<{ passed: boolean; status: string; detail: string }> {
  const grading = exercise.grading;
  if (grading.kind !== 'function-cases') {
    return { passed: false, status: 'unsupported', detail: 'not a function exercise' };
  }
  const response = await runner.run(
    buildRequest(source, grading.language, grading.entrypoint, grading.cases, grading.assertInputUnchanged),
  );
  const failed = response.caseResults.filter((c) => !c.passed);
  const detail =
    response.status === 'passed'
      ? 'all cases passed'
      : failed.length > 0
        ? `failed cases: ${failed.map((c) => c.caseId).join(', ')}`
        : (response.message ?? response.status);
  return { passed: response.status === 'passed', status: response.status, detail };
}

export async function verifyPackage(
  pkg: ContentPackage,
  sidecar: VerificationSidecar = EMPTY_SIDECAR,
  preferFallbackRunner = false,
): Promise<{ issues: Issue[]; report: VerificationReport }> {
  const runner = await resolveRunner(preferFallbackRunner);
  const issues: Issue[] = [];
  const checks: SolutionCheck[] = [];

  try {
    for (const [index, item] of pkg.items.entries()) {
      if (item.kind !== 'exercise') continue;
      if (item.grading.kind !== 'function-cases') continue;

      const base = `items[${index}]`;
      const solutionCode = item.solution.code ?? '';
      const check: SolutionCheck = {
        exerciseId: item.id,
        solutionPassed: false,
        starterFailsAsExpected: false,
        starterExempt: Object.hasOwn(sidecar.starterExemptions, item.id),
        mutantsRejected: [],
        mutantsAccepted: [],
      };

      // 1. Reference solution must pass every case.
      const solutionRun = await runSource(runner, item, solutionCode);
      if (solutionRun.status === 'unsupported') {
        check.skipped = solutionRun.detail;
        checks.push(check);
        issues.push(
          warn('verify.skipped', `${base}.solution.code`, `solution not verified: ${solutionRun.detail}`, item.id),
        );
        continue;
      }
      check.solutionPassed = solutionRun.passed;
      if (!solutionRun.passed) {
        issues.push(
          err(
            'verify.solution-failed',
            `${base}.solution.code`,
            `reference solution does not pass its own cases (${solutionRun.status}: ${solutionRun.detail})`,
            item.id,
          ),
        );
      }

      // 2. Starter must fail at least one case, unless explicitly exempt.
      const starterRun = await runSource(runner, item, item.grading.starterCode);
      check.starterFailsAsExpected = !starterRun.passed;
      if (starterRun.passed && !check.starterExempt) {
        issues.push(
          err(
            'verify.starter-already-passes',
            `${base}.grading.starterCode`,
            'the starter already passes every case, so there is nothing to practise; declare a starterExemption with a reason if this is a read-only worked example',
            item.id,
          ),
        );
      }
      if (!starterRun.passed && check.starterExempt) {
        issues.push(
          warn(
            'verify.needless-exemption',
            `${base}.grading.starterCode`,
            'this exercise has a starter exemption but its starter already fails; remove the exemption',
            item.id,
          ),
        );
      }

      // 3. Wrong implementations must be rejected by the grading cases.
      const declared: MutantSpec[] = (sidecar.declaredMutants[item.id] ?? []).map((m) => ({
        ...m,
        severity: 'required' as const,
      }));
      for (const mutant of generateMutants(item, declared)) {
        const mutantRun = await runSource(runner, item, mutant.source);
        if (mutantRun.passed) {
          check.mutantsAccepted.push(mutant.id);
          const issue = mutant.severity === 'required' ? err : warn;
          issues.push(
            issue(
              'verify.mutant-survived',
              `${base}.grading.cases`,
              `a wrong implementation passes every case (${mutant.id}: ${mutant.rationale}) — add a case that distinguishes it`,
              item.id,
            ),
          );
        } else {
          check.mutantsRejected.push(mutant.id);
        }
      }

      checks.push(check);
    }
  } finally {
    await runner.dispose();
  }

  return { issues, report: { runnerBackend: runner.name, checks } };
}
