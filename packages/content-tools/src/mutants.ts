import type { ExerciseItem } from '@devpractice/contracts';

/**
 * Deliberate incorrect variants (spec §10.4).
 *
 * A grading definition is only trustworthy if it REJECTS plausible wrong
 * implementations. Every mutant here is run through the same runner contract as
 * the reference solution; a mutant that still passes every case means the cases
 * are too weak, not that the mutant is correct.
 *
 * `required` mutants must always be killed — a survivor is a gate ERROR.
 * `heuristic` mutants may be semantically equivalent to the reference solution
 * (e.g. flipping `<` to `<=` where the boundary is unreachable), so a survivor
 * is a WARNING the author should look at rather than an automatic failure.
 */

export interface MutantSpec {
  id: string;
  source: string;
  severity: 'required' | 'heuristic';
  rationale: string;
}

const MAX_CONSTANT_MUTANTS = 3;

function functionWrapper(entrypoint: string, body: string): string {
  return `function ${entrypoint}(...args) { ${body} }`;
}

/**
 * Distinct expected values across the cases, most frequent first.
 *
 * `expected` is optional on a grading case (a case may assert only that the
 * call does not throw), so it is accepted as optional here and a missing value
 * simply keys as `undefined` rather than being a type error.
 */
function distinctExpected(cases: { expected?: unknown }[]): string[] {
  const counts = new Map<string, number>();
  for (const c of cases) {
    const key = JSON.stringify(c.expected) ?? 'undefined';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CONSTANT_MUTANTS)
    .map(([key]) => key);
}

export function generateMutants(exercise: ExerciseItem, declared: MutantSpec[] = []): MutantSpec[] {
  const grading = exercise.grading;
  if (grading.kind !== 'function-cases') return [];
  const { entrypoint, cases, assertInputUnchanged } = grading;
  const solution = exercise.solution.code ?? '';
  const mutants: MutantSpec[] = [];

  // 1. Constant returns. If every case expects the same value, a constant
  //    mutant CANNOT be killed — which correctly flags under-specified cases.
  for (const literal of distinctExpected(cases)) {
    mutants.push({
      id: `constant-${literal.slice(0, 24)}`,
      source: functionWrapper(entrypoint, `return ${literal};`),
      severity: 'required',
      rationale: `always returns ${literal} regardless of input`,
    });
  }

  // 2. Echo the first argument back.
  mutants.push({
    id: 'identity-first-arg',
    source: functionWrapper(entrypoint, 'return args[0];'),
    severity: 'required',
    rationale: 'returns its first argument unchanged',
  });

  // 3. Selection that accepts everything (the spec's "count-all" mutant).
  if (/\.filter\s*\(/.test(solution)) {
    mutants.push({
      id: 'filter-accepts-all',
      source: solution.replace(/\.filter\s*\(([^)]*)\)/, '.filter(() => true)'),
      severity: 'required',
      rationale: 'filter predicate accepts every record',
    });
  }

  // 4. Correct result, but the input is mutated on the way (spec §10.3).
  //    The reference solution is wrapped in an IIFE so there is exactly one
  //    binding named `entrypoint` in scope — the mutating wrapper. The injected
  //    record carries no meaningful fields, so the ANSWER stays correct and the
  //    only thing that can fail is the input-unchanged check itself.
  if (assertInputUnchanged) {
    mutants.push({
      id: 'mutates-input',
      source: [
        `const __ref = (function () {`,
        solution,
        `  return ${entrypoint};`,
        `})();`,
        `function ${entrypoint}(...args) {`,
        `  const first = args[0];`,
        `  if (Array.isArray(first)) { first.push({ __injectedByMutant: true }); }`,
        `  else if (first && typeof first === 'object') { first.__injectedByMutant = true; }`,
        `  return __ref(...args);`,
        `}`,
      ].join('\n'),
      severity: 'required',
      rationale: 'produces the right answer but mutates the caller input',
    });
  }

  // 5. Source-level operator mutations. Equivalent-mutant risk -> heuristic.
  const operatorMutations: { id: string; from: RegExp; to: string; why: string }[] = [
    { id: 'flip-strict-equality', from: /===/, to: '!==', why: 'equality comparison inverted' },
    { id: 'flip-loose-negation', from: /!==/, to: '===', why: 'inequality comparison inverted' },
    { id: 'off-by-one-lt', from: /([^<>=!])<([^=])/, to: '$1<=$2', why: 'boundary widened' },
    { id: 'off-by-one-gt', from: /([^<>=!])>([^=])/, to: '$1>=$2', why: 'boundary widened' },
    { id: 'zero-start-index', from: /\b1\b/, to: '0', why: 'literal 1 replaced with 0' },
  ];
  for (const mutation of operatorMutations) {
    if (!mutation.from.test(solution)) continue;
    const mutated = solution.replace(mutation.from, mutation.to);
    if (mutated === solution) continue;
    mutants.push({
      id: mutation.id,
      source: mutated,
      severity: 'heuristic',
      rationale: mutation.why,
    });
  }

  // 6. Author-declared mutants from the sidecar file always take priority.
  return [...mutants, ...declared];
}
