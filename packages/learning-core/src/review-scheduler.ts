import {
  REVIEW_AGAIN_DELAY_MINUTES,
  REVIEW_INTERVAL_DAYS,
  REVIEW_MAX_STEP,
} from '@devpractice/contracts';
import { addDays, addMinutes } from './clock.js';

/**
 * Deterministic review scheduler (spec 3.6).
 *
 * This is a transparent product heuristic, not a validated measurement of
 * memory. It is deliberately small: no learning-science library is introduced
 * before the platform needs one.
 */

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewCardState {
  step: number;
  dueAt: Date;
  lastReviewedAt: Date | null;
  revision: number;
}

export interface ScheduleInput {
  state: Pick<ReviewCardState, 'step'>;
  rating: ReviewRating;
  /**
   * Objective grading result, when the card is checked rather than self-rated.
   * `false` forces Again no matter which rating the learner submitted.
   */
  correctness?: boolean | null;
  /** Server acceptance time; every interval is measured from this. */
  acceptedAt: Date;
}

export interface ScheduleResult {
  step: number;
  dueAt: Date;
  lastReviewedAt: Date;
  /** The rating actually applied after the correctness override. */
  effectiveRating: ReviewRating;
  ratingWasForced: boolean;
}

/**
 * Interval for a card that has just ARRIVED at `step`.
 *
 * Steps run 0..5. A card at step 0 is due immediately; each successful Good
 * walks the published ladder 1, 3, 7, 14, 30 days and then stays at 30.
 * REVIEW_INTERVAL_DAYS is the shared source of those numbers; the unit tests
 * assert this table and that constant never drift apart.
 */
export function intervalDaysForStep(step: number): number {
  if (step <= 0) return 0;
  const index = Math.min(step, REVIEW_MAX_STEP) - 1;
  return REVIEW_INTERVAL_DAYS[index] ?? REVIEW_INTERVAL_DAYS[REVIEW_INTERVAL_DAYS.length - 1] ?? 30;
}

export function clampStep(step: number): number {
  if (!Number.isFinite(step)) return 0;
  return Math.max(0, Math.min(REVIEW_MAX_STEP, Math.trunc(step)));
}

/**
 * A newly introduced card starts at step 0 and is immediately due.
 * Importing content alone never enrols a card — enrolment is an explicit act
 * (first lesson completion, or "Add to review").
 */
export function newCardState(introducedAt: Date): ReviewCardState {
  return { step: 0, dueAt: new Date(introducedAt), lastReviewedAt: null, revision: 1 };
}

export function scheduleReview(input: ScheduleInput): ScheduleResult {
  const currentStep = clampStep(input.state.step);
  const forced = input.correctness === false;
  const effectiveRating: ReviewRating = forced ? 'again' : input.rating;
  const at = input.acceptedAt;

  let step: number;
  let dueAt: Date;

  switch (effectiveRating) {
    case 'again':
      step = 0;
      dueAt = addMinutes(at, REVIEW_AGAIN_DELAY_MINUTES);
      break;
    case 'hard':
      // Keeps the step and schedules one day later.
      step = currentStep;
      dueAt = addDays(at, 1);
      break;
    case 'good':
      step = clampStep(currentStep + 1);
      dueAt = addDays(at, intervalDaysForStep(step));
      break;
    case 'easy':
      step = clampStep(currentStep + 2);
      dueAt = addDays(at, intervalDaysForStep(step));
      break;
  }

  return {
    step,
    dueAt,
    lastReviewedAt: new Date(at),
    effectiveRating,
    ratingWasForced: forced && input.rating !== 'again',
  };
}

/** Queue ordering: overdue first (oldest due first), then newly introduced. */
export interface QueueCard {
  cardId: string;
  step: number;
  dueAt: Date;
  lastReviewedAt: Date | null;
}

export const DEFAULT_REVIEW_BATCH = 20;

export function orderDueQueue<T extends QueueCard>(cards: T[], now: Date): T[] {
  const due = cards.filter((c) => c.dueAt.getTime() <= now.getTime());
  const overdue = due.filter((c) => c.lastReviewedAt !== null);
  const fresh = due.filter((c) => c.lastReviewedAt === null);
  const byDue = (a: QueueCard, b: QueueCard) =>
    a.dueAt.getTime() - b.dueAt.getTime() || a.cardId.localeCompare(b.cardId);
  return [...overdue.sort(byDue), ...fresh.sort(byDue)];
}
