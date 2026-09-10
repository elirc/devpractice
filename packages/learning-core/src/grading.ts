import { jsonEqual } from '@devpractice/contracts';

/**
 * Objective grading (spec 3.3).
 *
 * The server never executes learner source. For browser-run function
 * exercises it verifies that the CLIENT-REPORTED result is self-consistent
 * with the pinned case definition — a claim of "passed" that does not account
 * for every authored case is rejected. This is honest bookkeeping for personal
 * learning, not proctoring: the runner is inspectable by design.
 */

export interface ChoiceOption {
  id: string;
  correct: boolean;
  explanationMarkdown: string;
}

export interface ChoiceGrading {
  kind: 'choice';
  mode: 'single' | 'multiple';
  options: ChoiceOption[];
}

export interface ChoiceResult {
  correct: boolean;
  selectedOptionIds: string[];
  correctOptionIds: string[];
  /** Answer-specific explanations, shown after submission. */
  optionExplanations: Record<string, string>;
  invalidOptionIds: string[];
}

export function gradeChoice(grading: ChoiceGrading, selected: string[]): ChoiceResult {
  const optionIds = new Set(grading.options.map((o) => o.id));
  const uniqueSelected = [...new Set(selected)];
  const invalidOptionIds = uniqueSelected.filter((id) => !optionIds.has(id));
  const correctOptionIds = grading.options.filter((o) => o.correct).map((o) => o.id);

  const optionExplanations: Record<string, string> = {};
  for (const option of grading.options) optionExplanations[option.id] = option.explanationMarkdown;

  if (invalidOptionIds.length > 0) {
    return {
      correct: false,
      selectedOptionIds: uniqueSelected,
      correctOptionIds,
      optionExplanations,
      invalidOptionIds,
    };
  }

  let correct: boolean;
  if (grading.mode === 'single') {
    correct = uniqueSelected.length === 1 && correctOptionIds.includes(uniqueSelected[0] as string);
  } else {
    // V1 multiple choice is exact set equality.
    const a = [...uniqueSelected].sort();
    const b = [...correctOptionIds].sort();
    correct = a.length === b.length && a.every((v, i) => v === b[i]);
  }

  return {
    correct,
    selectedOptionIds: uniqueSelected,
    correctOptionIds,
    optionExplanations,
    invalidOptionIds,
  };
}

export interface PredictOutputGrading {
  kind: 'predict-output';
  normalization: { trim: boolean; collapseWhitespace: boolean; caseSensitive: boolean };
  expected: string;
  acceptedAlternatives: string[];
}

/** Normalization is explicit per exercise; nothing is applied implicitly. */
export function normalizeOutput(
  raw: string,
  rules: PredictOutputGrading['normalization'],
): string {
  let value = raw.replace(/\r\n/g, '\n');
  if (rules.collapseWhitespace) value = value.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n');
  if (rules.trim) value = value.trim();
  if (!rules.caseSensitive) value = value.toLowerCase();
  return value;
}

export interface PredictOutputResult {
  correct: boolean;
  submittedNormalized: string;
  expectedNormalized: string;
}

export function gradePredictOutput(
  grading: PredictOutputGrading,
  submitted: string,
): PredictOutputResult {
  const submittedNormalized = normalizeOutput(submitted, grading.normalization);
  const accepted = [grading.expected, ...grading.acceptedAlternatives].map((v) =>
    normalizeOutput(v, grading.normalization),
  );
  return {
    correct: accepted.includes(submittedNormalized),
    submittedNormalized,
    expectedNormalized: normalizeOutput(grading.expected, grading.normalization),
  };
}

export interface FunctionCase {
  id: string;
  args: unknown[];
  expected: unknown;
  tolerance?: number;
  hidden: boolean;
}

export interface FunctionGrading {
  kind: 'function-cases';
  language: 'javascript' | 'typescript';
  entrypoint: string;
  starterCode: string;
  assertInputUnchanged: boolean;
  cases: FunctionCase[];
}

export interface ReportedRunnerResult {
  status:
    | 'passed'
    | 'failed'
    | 'compile_error'
    | 'runtime_error'
    | 'timed_out'
    | 'cancelled'
    | 'unsupported';
  passedCaseIds: string[];
  failedCaseIds: string[];
  durationMs: number;
  message?: string;
}

export interface FunctionVerification {
  accepted: boolean;
  /** Why a claimed pass was refused; empty when the report is consistent. */
  rejectionReasons: string[];
  passedCaseIds: string[];
  caseResults: { caseId: string; passed: boolean }[];
}

/**
 * Verify a browser-reported function result against the pinned definition.
 * Unknown, duplicated or missing case ids invalidate a claimed pass.
 */
export function verifyFunctionReport(
  grading: FunctionGrading,
  report: ReportedRunnerResult,
): FunctionVerification {
  const pinned = grading.cases.map((c) => c.id);
  const pinnedSet = new Set(pinned);
  const reasons: string[] = [];

  const passed = report.passedCaseIds;
  const failed = report.failedCaseIds ?? [];
  const all = [...passed, ...failed];

  if (new Set(all).size !== all.length) reasons.push('duplicate case ids in report');
  for (const id of all) {
    if (!pinnedSet.has(id)) reasons.push(`unknown case id: ${id}`);
  }
  if (passed.some((id) => failed.includes(id))) {
    reasons.push('a case id was reported both passed and failed');
  }

  if (report.status === 'passed') {
    const missing = pinned.filter((id) => !passed.includes(id));
    if (missing.length > 0) reasons.push(`claimed pass omits cases: ${missing.join(', ')}`);
    if (failed.length > 0) reasons.push('claimed pass reports failing cases');
  }

  const caseResults = pinned.map((caseId) => ({ caseId, passed: passed.includes(caseId) }));
  const accepted = reasons.length === 0 && report.status === 'passed';

  return { accepted, rejectionReasons: reasons, passedCaseIds: passed.filter((id) => pinnedSet.has(id)), caseResults };
}

/** Structural comparison used by the content CLI when it runs reference solutions. */
export function caseMatches(expected: unknown, actual: unknown, tolerance?: number): boolean {
  return jsonEqual(expected, actual, tolerance);
}
