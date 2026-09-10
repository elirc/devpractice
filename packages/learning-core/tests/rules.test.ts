import { describe, expect, it } from 'vitest';
import { gradePlacement, isPracticeOnly } from '../src/placement.js';
import {
  exercisePassAward,
  lessonCompletionAward,
  levelForXp,
  missionCompletionAward,
  xpAwardKeys,
} from '../src/xp.js';
import {
  checkLessonCompletion,
  hasUpdatedPractice,
  nextLessonStatus,
} from '../src/lesson-completion.js';
import { classifyItemChange, decideVersion, summariseRelease, type DiffItem } from '../src/content-diff.js';

describe('placement qualification', () => {
  const items = (correct: boolean[], criticalIndexes: number[] = [0]) =>
    correct.map((c, i) => ({
      itemId: `i${i}`,
      critical: criticalIndexes.includes(i),
      correct: c,
    }));

  it('qualifies at four of five with all critical items passing', () => {
    const result = gradePlacement(items([true, true, true, true, false]));
    expect(result.score).toBe(4);
    expect(result.qualified).toBe(true);
  });

  it('does not qualify at three of five', () => {
    expect(gradePlacement(items([true, true, true, false, false])).qualified).toBe(false);
  });

  it('does not qualify when a critical item fails, even at four of five', () => {
    const result = gradePlacement(items([false, true, true, true, true]));
    expect(result.score).toBe(4);
    expect(result.qualified).toBe(false);
    expect(result.failedCriticalItemIds).toEqual(['i0']);
  });

  it('marks a repeat attempt on a revealed assessment version as practice only', () => {
    expect(isPracticeOnly(0)).toBe(false);
    expect(isPracticeOnly(1)).toBe(true);
  });
});

describe('xp', () => {
  it('keys an exercise award by mastery revision so new practice can earn again', () => {
    expect(xpAwardKeys.exercisePass('ex-1', 1)).toBe('exercise:ex-1:r1');
    expect(xpAwardKeys.exercisePass('ex-1', 2)).not.toBe(xpAwardKeys.exercisePass('ex-1', 1));
  });

  it('awards the published amounts', () => {
    expect(exercisePassAward('ex-1', 1).amount).toBe(10);
    expect(lessonCompletionAward('l-1').amount).toBe(20);
    expect(missionCompletionAward('m-1').amount).toBe(50);
  });

  it('keys a lesson completion once for the lifetime of the lesson', () => {
    expect(lessonCompletionAward('l-1').awardKey).toBe('lesson:l-1');
  });

  it('computes levels at 250 XP each', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(249)).toBe(1);
    expect(levelForXp(250)).toBe(2);
    expect(levelForXp(1000)).toBe(5);
  });
});

describe('lesson completion', () => {
  const required = [
    {
      exerciseId: 'e1',
      masteryRevision: 1,
      requiresSelfAssessment: false,
      hasPassingAttempt: true,
      hasSelfAssessment: false,
    },
    {
      exerciseId: 'e2',
      masteryRevision: 1,
      requiresSelfAssessment: true,
      hasPassingAttempt: false,
      hasSelfAssessment: true,
    },
  ];

  it('needs reading acknowledgement plus every required objective satisfied', () => {
    expect(checkLessonCompletion(required, true).satisfied).toBe(true);
    expect(checkLessonCompletion(required, false).satisfied).toBe(false);
  });

  it('reports which required exercises are missing', () => {
    const incomplete = [{ ...required[0]!, hasPassingAttempt: false }, required[1]!];
    const check = checkLessonCompletion(incomplete, true);
    expect(check.satisfied).toBe(false);
    expect(check.missingExerciseIds).toEqual(['e1']);
  });

  it('accepts a self-assessment for a rubric exercise but not a passing attempt', () => {
    const rubricOnly = [{ ...required[1]!, hasSelfAssessment: false, hasPassingAttempt: true }];
    expect(checkLessonCompletion(rubricOnly, true).satisfied).toBe(false);
  });

  it('never regresses a completed lesson', () => {
    expect(nextLessonStatus('completed', 'skip')).toBe('completed');
    expect(nextLessonStatus('completed', 'start')).toBe('completed');
    expect(nextLessonStatus('skipped', 'complete')).toBe('completed');
    expect(nextLessonStatus('not_started', 'start')).toBe('in_progress');
    expect(nextLessonStatus('not_started', 'skip')).toBe('skipped');
  });

  it('flags updated practice when a required exercise gains a mastery revision', () => {
    const completedAgainst = [{ exerciseId: 'e1', masteryRevision: 1 }];
    expect(hasUpdatedPractice(completedAgainst, [{ exerciseId: 'e1', masteryRevision: 2 }])).toBe(true);
    expect(hasUpdatedPractice(completedAgainst, [{ exerciseId: 'e1', masteryRevision: 1 }])).toBe(false);
    // A brand new exercise is not "updated practice" for the old completion.
    expect(hasUpdatedPractice(completedAgainst, [{ exerciseId: 'e9', masteryRevision: 1 }])).toBe(false);
  });
});

describe('content change classification', () => {
  const base: DiffItem = {
    id: 'js-arrays-filter-open',
    kind: 'exercise',
    version: 3,
    masteryRevision: 2,
    title: 'Count open support tickets',
    promptMarkdown: 'Return the number of tickets whose status is exactly open.',
    hints: ['a', 'b', 'c'],
    grading: { kind: 'function-cases', cases: [{ id: 'empty', expected: 0 }] },
    solution: { code: 'return 0;', explanationMarkdown: 'why' },
  };

  it('treats a clarified prompt as editorial and preserves the mastery revision', () => {
    const next = { ...base, promptMarkdown: 'Return how many tickets have status exactly "open".' };
    expect(classifyItemChange(base, next)).toBe('editorial');
    const decision = decideVersion(base, next);
    expect(decision.version).toBe(4);
    expect(decision.masteryRevision).toBe(2);
  });

  it('treats changed grading cases as behavioural and bumps the mastery revision', () => {
    const next = {
      ...base,
      grading: { kind: 'function-cases', cases: [{ id: 'empty', expected: 0 }, { id: 'upper', expected: 0 }] },
    };
    expect(classifyItemChange(base, next)).toBe('behavioural');
    const decision = decideVersion(base, next);
    expect(decision.version).toBe(4);
    expect(decision.masteryRevision).toBe(3);
  });

  it('treats a changed solution as behavioural', () => {
    const next = { ...base, solution: { code: 'return 1;', explanationMarkdown: 'why' } };
    expect(classifyItemChange(base, next)).toBe('behavioural');
  });

  it('treats rewritten hints as editorial', () => {
    expect(classifyItemChange(base, { ...base, hints: ['x', 'y', 'z'] })).toBe('editorial');
  });

  it('ignores key reordering', () => {
    const reordered: DiffItem = {
      masteryRevision: base.masteryRevision,
      version: base.version,
      kind: base.kind,
      id: base.id,
      solution: { explanationMarkdown: 'why', code: 'return 0;' },
      grading: base.grading,
      hints: base.hints,
      promptMarkdown: base.promptMarkdown,
      title: base.title,
    };
    expect(classifyItemChange(base, reordered)).toBe('unchanged');
    expect(decideVersion(base, reordered).version).toBe(3);
  });

  it('summarises a release into added, changed, archived and unchanged', () => {
    const previous = [base, { ...base, id: 'to-archive' }];
    const next = [
      { ...base, promptMarkdown: 'clarified' },
      { ...base, id: 'brand-new' },
    ];
    const summary = summariseRelease(previous, next);
    expect(summary.editorial).toEqual([base.id]);
    expect(summary.added).toEqual(['brand-new']);
    expect(summary.archived).toEqual(['to-archive']);
    expect(summary.masteryRevisionsAffected).toEqual([]);
  });
});
