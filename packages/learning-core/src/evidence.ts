import type {
  Assistance,
  AttemptOutcome,
  ConceptStatus,
  GradingOrigin,
} from '@devpractice/contracts';
import { utcDateKey } from './clock.js';

/**
 * Concept evidence derivation (spec 3.4).
 *
 * These thresholds are configurable product heuristics, not validated
 * measurements of competence. Completion, placement, assistance and retained
 * understanding stay distinct records; nothing here overwrites history.
 */

export type ExerciseType =
  | 'choice'
  | 'predict-output'
  | 'code-reading'
  | 'function'
  | 'explanation'
  | 'local-project';

export type CognitiveLevel = 'recall' | 'application' | 'debugging' | 'self_assessed';

/**
 * Which activities count as "application or debugging rather than recall".
 * Choice and output-prediction exercise recognition; writing a function is
 * application; reading code to find a defect is debugging. Rubric and local
 * project work is self-assessed and never counts as objective evidence.
 */
export const EXERCISE_COGNITIVE_LEVEL: Record<ExerciseType, CognitiveLevel> = {
  choice: 'recall',
  'predict-output': 'recall',
  'code-reading': 'debugging',
  function: 'application',
  explanation: 'self_assessed',
  'local-project': 'self_assessed',
};

export function isApplicationOrDebugging(type: ExerciseType): boolean {
  const level = EXERCISE_COGNITIVE_LEVEL[type];
  return level === 'application' || level === 'debugging';
}

/** Objective grading origins. Self-reported work is learning, not proof. */
export function isObjectiveOrigin(origin: GradingOrigin): boolean {
  return origin === 'server_objective' || origin === 'browser_automated';
}

export interface EvidenceAttempt {
  /** Exercise or placement-item id. Distinct ids are required for mastery. */
  itemId: string;
  masteryRevision: number;
  conceptId: string;
  exerciseType: ExerciseType;
  outcome: AttemptOutcome;
  gradingOrigin: GradingOrigin;
  assistance: Assistance;
  createdAt: Date;
}

export interface EvidenceReview {
  conceptId: string;
  cardId: string;
  /** null when the learner self-rated a free-recall card. */
  correctness: boolean | null;
  gradingOrigin: GradingOrigin;
  /** Was the card actually due when it was answered? */
  wasDue: boolean;
  createdAt: Date;
}

export interface ConceptScheduleState {
  conceptId: string;
  nextDueAt: Date | null;
}

export interface ConceptEvidence {
  conceptId: string;
  status: ConceptStatus;
  independentPasses: number;
  assistedPasses: number;
  applicationOrDebugPasses: number;
  distinctIndependentItemIds: string[];
  successfulReviewDates: string[];
  selfRatedReviewCount: number;
  nextDueAt: Date | null;
}

export const DEMONSTRATION_REQUIRED_PASSES = 2;
export const RETENTION_REQUIRED_REVIEWS = 2;
export const RETENTION_MIN_DAYS_BETWEEN_REVIEWS = 7;

const MS_PER_DAY = 86_400_000;

/**
 * `demonstrated` requires two passing OBJECTIVE activities on DISTINCT item
 * ids, both fully independent (no hints, no solution reveal for that mastery
 * revision), at least one of which is application or debugging.
 */
function qualifyingPasses(attempts: EvidenceAttempt[]): EvidenceAttempt[] {
  return attempts.filter(
    (a) =>
      a.outcome === 'passed' &&
      isObjectiveOrigin(a.gradingOrigin) &&
      a.assistance === 'none',
  );
}

/**
 * `retained` needs two successful due reviews on separate UTC dates, the
 * second at least seven days after the first. Only objectively checked correct
 * reviews count; self-rated reviews schedule practice and are reported apart.
 */
export function findRetentionPair(reviews: EvidenceReview[]): [Date, Date] | null {
  const successful = reviews
    .filter(
      (r) =>
        r.wasDue &&
        r.correctness === true &&
        r.gradingOrigin === 'server_objective',
    )
    .map((r) => r.createdAt)
    .sort((a, b) => a.getTime() - b.getTime());

  for (let i = 0; i < successful.length; i += 1) {
    const first = successful[i];
    if (!first) continue;
    for (let j = i + 1; j < successful.length; j += 1) {
      const second = successful[j];
      if (!second) continue;
      const separateDates = utcDateKey(first) !== utcDateKey(second);
      const farEnoughApart =
        second.getTime() - first.getTime() >= RETENTION_MIN_DAYS_BETWEEN_REVIEWS * MS_PER_DAY;
      if (separateDates && farEnoughApart) return [first, second];
    }
  }
  return null;
}

export function classifyConcept(
  conceptId: string,
  attempts: EvidenceAttempt[],
  reviews: EvidenceReview[],
  schedule: ConceptScheduleState | null,
  now: Date,
): ConceptEvidence {
  const mine = attempts.filter((a) => a.conceptId === conceptId);
  const myReviews = reviews.filter((r) => r.conceptId === conceptId);

  const passes = qualifyingPasses(mine);
  const distinctIndependentItemIds = [...new Set(passes.map((p) => p.itemId))];
  const assistedPasses = mine.filter(
    (a) => a.outcome === 'passed' && a.assistance !== 'none',
  ).length;
  const applicationOrDebugPasses = passes.filter((p) =>
    isApplicationOrDebugging(p.exerciseType),
  ).length;

  const demonstrated =
    distinctIndependentItemIds.length >= DEMONSTRATION_REQUIRED_PASSES &&
    applicationOrDebugPasses >= 1;

  const retentionPair = findRetentionPair(myReviews);
  const successfulReviewDates = myReviews
    .filter((r) => r.wasDue && r.correctness === true && r.gradingOrigin === 'server_objective')
    .map((r) => utcDateKey(r.createdAt));
  const selfRatedReviewCount = myReviews.filter((r) => r.correctness === null).length;

  const nextDueAt = schedule?.nextDueAt ?? null;
  const overdue = nextDueAt !== null && nextDueAt.getTime() <= now.getTime();

  let status: ConceptStatus;
  if (mine.length === 0 && myReviews.length === 0) {
    status = 'unseen';
  } else if (demonstrated && retentionPair !== null) {
    // History is never deleted; an overdue card only changes the label.
    status = overdue ? 'review_due' : 'retained';
  } else if (demonstrated) {
    status = 'demonstrated';
  } else {
    status = 'practicing';
  }

  return {
    conceptId,
    status,
    independentPasses: passes.length,
    assistedPasses,
    applicationOrDebugPasses,
    distinctIndependentItemIds,
    successfulReviewDates,
    selfRatedReviewCount,
    nextDueAt,
  };
}

export function classifyAllConcepts(
  conceptIds: string[],
  attempts: EvidenceAttempt[],
  reviews: EvidenceReview[],
  schedules: ConceptScheduleState[],
  now: Date,
): ConceptEvidence[] {
  const byConcept = new Map(schedules.map((s) => [s.conceptId, s]));
  return conceptIds.map((id) =>
    classifyConcept(id, attempts, reviews, byConcept.get(id) ?? null, now),
  );
}
