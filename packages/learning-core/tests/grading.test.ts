import { describe, expect, it } from 'vitest';
import {
  gradeChoice,
  gradePredictOutput,
  normalizeOutput,
  verifyFunctionReport,
  type ChoiceGrading,
  type FunctionGrading,
  type PredictOutputGrading,
} from '../src/grading.js';

const choice: ChoiceGrading = {
  kind: 'choice',
  mode: 'single',
  options: [
    { id: 'a', correct: true, explanationMarkdown: 'Correct: filter returns a new array.' },
    { id: 'b', correct: false, explanationMarkdown: 'filter does not mutate the input.' },
    { id: 'c', correct: false, explanationMarkdown: 'That is what map does.' },
  ],
};

describe('choice grading', () => {
  it('grades a single-choice answer and returns answer-specific explanations', () => {
    const result = gradeChoice(choice, ['a']);
    expect(result.correct).toBe(true);
    expect(result.optionExplanations.b).toContain('does not mutate');
  });

  it('rejects multiple selections in single mode', () => {
    expect(gradeChoice(choice, ['a', 'b']).correct).toBe(false);
  });

  it('uses exact set equality for multiple choice', () => {
    const multi: ChoiceGrading = {
      kind: 'choice',
      mode: 'multiple',
      options: [
        { id: 'a', correct: true, explanationMarkdown: 'x' },
        { id: 'b', correct: true, explanationMarkdown: 'y' },
        { id: 'c', correct: false, explanationMarkdown: 'z' },
      ],
    };
    expect(gradeChoice(multi, ['a', 'b']).correct).toBe(true);
    expect(gradeChoice(multi, ['b', 'a']).correct).toBe(true);
    expect(gradeChoice(multi, ['a']).correct).toBe(false);
    expect(gradeChoice(multi, ['a', 'b', 'c']).correct).toBe(false);
  });

  it('refuses unknown option ids instead of silently ignoring them', () => {
    const result = gradeChoice(choice, ['a', 'made-up']);
    expect(result.correct).toBe(false);
    expect(result.invalidOptionIds).toEqual(['made-up']);
  });
});

describe('predict-output grading', () => {
  const grading: PredictOutputGrading = {
    kind: 'predict-output',
    normalization: { trim: true, collapseWhitespace: true, caseSensitive: true },
    expected: '2',
    acceptedAlternatives: ['two'],
  };

  it('applies only the normalization the exercise declares', () => {
    expect(gradePredictOutput(grading, '  2  ').correct).toBe(true);
    expect(gradePredictOutput(grading, 'two').correct).toBe(true);
    expect(gradePredictOutput(grading, 'TWO').correct).toBe(false);

    const caseInsensitive: PredictOutputGrading = {
      ...grading,
      normalization: { ...grading.normalization, caseSensitive: false },
    };
    expect(gradePredictOutput(caseInsensitive, 'TWO').correct).toBe(true);
  });

  it('normalizes CRLF and collapses runs of spaces when asked', () => {
    expect(normalizeOutput('a  \r\n  b', { trim: true, collapseWhitespace: true, caseSensitive: true })).toBe('a\nb');
  });

  it('does not trim when trimming is switched off', () => {
    const strict: PredictOutputGrading = {
      ...grading,
      normalization: { trim: false, collapseWhitespace: false, caseSensitive: true },
    };
    expect(gradePredictOutput(strict, ' 2').correct).toBe(false);
  });
});

describe('browser-reported function results', () => {
  const grading: FunctionGrading = {
    kind: 'function-cases',
    language: 'javascript',
    entrypoint: 'countOpen',
    starterCode: 'function countOpen(t) { return 0; }',
    assertInputUnchanged: true,
    cases: [
      { id: 'empty', args: [[]], expected: 0, hidden: false },
      { id: 'mixed', args: [[{ status: 'open' }]], expected: 1, hidden: false },
      { id: 'all-closed', args: [[{ status: 'closed' }]], expected: 0, hidden: false },
    ],
  };

  it('accepts a report that accounts for every pinned case', () => {
    const result = verifyFunctionReport(grading, {
      status: 'passed',
      passedCaseIds: ['empty', 'mixed', 'all-closed'],
      failedCaseIds: [],
      durationMs: 12,
    });
    expect(result.accepted).toBe(true);
    expect(result.rejectionReasons).toEqual([]);
  });

  it('refuses a claimed pass that omits authored cases', () => {
    const result = verifyFunctionReport(grading, {
      status: 'passed',
      passedCaseIds: ['empty'],
      failedCaseIds: [],
      durationMs: 3,
    });
    expect(result.accepted).toBe(false);
    expect(result.rejectionReasons.join(' ')).toContain('omits cases');
  });

  it('refuses unknown, duplicated or contradictory case ids', () => {
    expect(
      verifyFunctionReport(grading, {
        status: 'passed',
        passedCaseIds: ['empty', 'mixed', 'all-closed', 'invented'],
        failedCaseIds: [],
        durationMs: 3,
      }).rejectionReasons.join(' '),
    ).toContain('unknown case id');

    expect(
      verifyFunctionReport(grading, {
        status: 'passed',
        passedCaseIds: ['empty', 'empty', 'mixed', 'all-closed'],
        failedCaseIds: [],
        durationMs: 3,
      }).rejectionReasons.join(' '),
    ).toContain('duplicate');

    expect(
      verifyFunctionReport(grading, {
        status: 'passed',
        passedCaseIds: ['empty', 'mixed', 'all-closed'],
        failedCaseIds: ['mixed'],
        durationMs: 3,
      }).accepted,
    ).toBe(false);
  });

  it('does not accept a failing or errored run as a pass', () => {
    for (const status of ['failed', 'compile_error', 'timed_out', 'cancelled'] as const) {
      const result = verifyFunctionReport(grading, {
        status,
        passedCaseIds: ['empty', 'mixed', 'all-closed'],
        failedCaseIds: [],
        durationMs: 1,
      });
      expect(result.accepted).toBe(false);
    }
  });

  it('reports per-case results covering the full pinned definition', () => {
    const result = verifyFunctionReport(grading, {
      status: 'failed',
      passedCaseIds: ['empty'],
      failedCaseIds: ['mixed', 'all-closed'],
      durationMs: 4,
    });
    expect(result.caseResults).toEqual([
      { caseId: 'empty', passed: true },
      { caseId: 'mixed', passed: false },
      { caseId: 'all-closed', passed: false },
    ]);
  });
});
