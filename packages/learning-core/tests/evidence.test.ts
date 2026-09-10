import { describe, expect, it } from 'vitest';
import {
  classifyConcept,
  findRetentionPair,
  isApplicationOrDebugging,
  type EvidenceAttempt,
  type EvidenceReview,
} from '../src/evidence.js';
import { assistanceForAttempt, summariseReveals } from '../src/assistance.js';

const CONCEPT = 'js.array-filter';
const NOW = new Date('2026-10-01T00:00:00.000Z');

function pass(overrides: Partial<EvidenceAttempt> = {}): EvidenceAttempt {
  return {
    itemId: 'ex-1',
    masteryRevision: 1,
    conceptId: CONCEPT,
    exerciseType: 'function',
    outcome: 'passed',
    gradingOrigin: 'browser_automated',
    assistance: 'none',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

function review(overrides: Partial<EvidenceReview> = {}): EvidenceReview {
  return {
    conceptId: CONCEPT,
    cardId: 'card-1',
    correctness: true,
    gradingOrigin: 'server_objective',
    wasDue: true,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('cognitive levels', () => {
  it('treats writing a function as application and reading code as debugging', () => {
    expect(isApplicationOrDebugging('function')).toBe(true);
    expect(isApplicationOrDebugging('code-reading')).toBe(true);
    expect(isApplicationOrDebugging('choice')).toBe(false);
    expect(isApplicationOrDebugging('predict-output')).toBe(false);
    expect(isApplicationOrDebugging('explanation')).toBe(false);
  });
});

describe('concept status', () => {
  it('is unseen with no activity at all', () => {
    expect(classifyConcept(CONCEPT, [], [], null, NOW).status).toBe('unseen');
  });

  it('is practicing after a single pass', () => {
    const result = classifyConcept(CONCEPT, [pass()], [], null, NOW);
    expect(result.status).toBe('practicing');
    expect(result.independentPasses).toBe(1);
  });

  it('needs two DISTINCT item ids, not two attempts at the same exercise', () => {
    const sameItemTwice = [pass(), pass({ createdAt: new Date('2026-09-02T00:00:00.000Z') })];
    expect(classifyConcept(CONCEPT, sameItemTwice, [], null, NOW).status).toBe('practicing');

    const twoItems = [pass(), pass({ itemId: 'ex-2', exerciseType: 'choice' })];
    expect(classifyConcept(CONCEPT, twoItems, [], null, NOW).status).toBe('demonstrated');
  });

  it('requires at least one application or debugging pass, not two recall passes', () => {
    const twoRecall = [
      pass({ itemId: 'ex-1', exerciseType: 'choice' }),
      pass({ itemId: 'ex-2', exerciseType: 'predict-output' }),
    ];
    const result = classifyConcept(CONCEPT, twoRecall, [], null, NOW);
    expect(result.applicationOrDebugPasses).toBe(0);
    expect(result.status).toBe('practicing');
  });

  it('ignores assisted passes as mastery evidence but still counts them', () => {
    const attempts = [
      pass({ itemId: 'ex-1', assistance: 'solution_viewed' }),
      pass({ itemId: 'ex-2', assistance: 'hints', exerciseType: 'code-reading' }),
    ];
    const result = classifyConcept(CONCEPT, attempts, [], null, NOW);
    expect(result.status).toBe('practicing');
    expect(result.assistedPasses).toBe(2);
    expect(result.independentPasses).toBe(0);
  });

  it('never lets a self-assessed rubric response alone demonstrate a concept', () => {
    const attempts = [
      pass({ itemId: 'ex-1', gradingOrigin: 'self_reported', exerciseType: 'explanation' }),
      pass({ itemId: 'ex-2', gradingOrigin: 'self_reported', exerciseType: 'local-project' }),
    ];
    expect(classifyConcept(CONCEPT, attempts, [], null, NOW).status).toBe('practicing');
  });

  it('accepts browser-automated passes as personal learning evidence', () => {
    const attempts = [
      pass({ itemId: 'ex-1', gradingOrigin: 'browser_automated', exerciseType: 'function' }),
      pass({ itemId: 'ex-2', gradingOrigin: 'server_objective', exerciseType: 'choice' }),
    ];
    expect(classifyConcept(CONCEPT, attempts, [], null, NOW).status).toBe('demonstrated');
  });
});

describe('retention', () => {
  const demonstrated = [pass({ itemId: 'ex-1' }), pass({ itemId: 'ex-2', exerciseType: 'choice' })];

  it('requires two successful due reviews at least seven days apart', () => {
    const tooClose = [
      review({ createdAt: new Date('2026-09-01T00:00:00.000Z') }),
      review({ createdAt: new Date('2026-09-06T00:00:00.000Z') }),
    ];
    expect(findRetentionPair(tooClose)).toBeNull();
    expect(classifyConcept(CONCEPT, demonstrated, tooClose, null, NOW).status).toBe('demonstrated');

    const farEnough = [
      review({ createdAt: new Date('2026-09-01T00:00:00.000Z') }),
      review({ createdAt: new Date('2026-09-08T00:00:00.000Z') }),
    ];
    expect(findRetentionPair(farEnough)).not.toBeNull();
    expect(classifyConcept(CONCEPT, demonstrated, farEnough, null, NOW).status).toBe('retained');
  });

  it('requires separate UTC dates', () => {
    const sameDay = [
      review({ createdAt: new Date('2026-09-01T01:00:00.000Z') }),
      review({ createdAt: new Date('2026-09-01T23:00:00.000Z') }),
    ];
    expect(findRetentionPair(sameDay)).toBeNull();
  });

  it('ignores self-rated reviews for objective retention but reports them', () => {
    const selfRated = [
      review({ correctness: null, gradingOrigin: 'self_reported' }),
      review({
        correctness: null,
        gradingOrigin: 'self_reported',
        createdAt: new Date('2026-09-20T00:00:00.000Z'),
      }),
    ];
    const result = classifyConcept(CONCEPT, demonstrated, selfRated, null, NOW);
    expect(result.status).toBe('demonstrated');
    expect(result.selfRatedReviewCount).toBe(2);
  });

  it('ignores reviews that were answered before they were due', () => {
    const notDue = [
      review({ wasDue: false }),
      review({ wasDue: false, createdAt: new Date('2026-09-20T00:00:00.000Z') }),
    ];
    expect(findRetentionPair(notDue)).toBeNull();
  });

  it('moves retained to review_due when a card is overdue, keeping the history', () => {
    const reviews = [
      review({ createdAt: new Date('2026-09-01T00:00:00.000Z') }),
      review({ createdAt: new Date('2026-09-08T00:00:00.000Z') }),
    ];
    const overdue = classifyConcept(
      CONCEPT,
      demonstrated,
      reviews,
      { conceptId: CONCEPT, nextDueAt: new Date('2026-09-30T00:00:00.000Z') },
      NOW,
    );
    expect(overdue.status).toBe('review_due');
    expect(overdue.successfulReviewDates).toEqual(['2026-09-01', '2026-09-08']);
    expect(overdue.distinctIndependentItemIds).toEqual(['ex-1', 'ex-2']);
  });
});

describe('assistance history (A06)', () => {
  const reveals = [
    {
      itemId: 'ex-1',
      masteryRevision: 1,
      revealKind: 'solution' as const,
      hintIndex: null,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    },
  ];

  it('keeps an item solution-assisted for that mastery revision after a reset', () => {
    expect(assistanceForAttempt(reveals, 'ex-1', 1)).toBe('solution_viewed');
  });

  it('does not leak assistance to a different item or a new mastery revision', () => {
    expect(assistanceForAttempt(reveals, 'ex-2', 1)).toBe('none');
    expect(assistanceForAttempt(reveals, 'ex-1', 2)).toBe('none');
  });

  it('records which hints were viewed', () => {
    const hintReveals = [
      { itemId: 'ex-9', masteryRevision: 1, revealKind: 'hint' as const, hintIndex: 0, createdAt: NOW },
      { itemId: 'ex-9', masteryRevision: 1, revealKind: 'hint' as const, hintIndex: 1, createdAt: NOW },
      { itemId: 'ex-9', masteryRevision: 1, revealKind: 'hint' as const, hintIndex: 1, createdAt: NOW },
    ];
    const summary = summariseReveals(hintReveals, 'ex-9', 1);
    expect(summary.hintIndexesRevealed).toEqual([0, 1]);
    expect(summary.solutionRevealed).toBe(false);
  });
});
