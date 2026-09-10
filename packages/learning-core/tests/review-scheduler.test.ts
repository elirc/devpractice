import { describe, expect, it } from 'vitest';
import { REVIEW_INTERVAL_DAYS, REVIEW_MAX_STEP } from '@devpractice/contracts';
import {
  DEFAULT_REVIEW_BATCH,
  clampStep,
  intervalDaysForStep,
  newCardState,
  orderDueQueue,
  scheduleReview,
} from '../src/review-scheduler.js';
import { MS_PER_DAY, MS_PER_MINUTE, fixedClock } from '../src/clock.js';

const T0 = new Date('2026-09-09T12:00:00.000Z');

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / MS_PER_DAY;
}

describe('interval ladder', () => {
  it('walks the published 1/3/7/14/30 ladder and never exceeds 30 days', () => {
    expect(intervalDaysForStep(0)).toBe(0);
    expect(intervalDaysForStep(1)).toBe(1);
    expect(intervalDaysForStep(2)).toBe(3);
    expect(intervalDaysForStep(3)).toBe(7);
    expect(intervalDaysForStep(4)).toBe(14);
    expect(intervalDaysForStep(5)).toBe(30);
    expect(intervalDaysForStep(99)).toBe(30);
  });

  it('stays consistent with the shared REVIEW_INTERVAL_DAYS constant', () => {
    // Guards against the contract and the scheduler drifting apart.
    for (let step = 1; step <= REVIEW_MAX_STEP; step += 1) {
      expect(intervalDaysForStep(step)).toBe(REVIEW_INTERVAL_DAYS[step - 1]);
    }
    expect(Math.max(...REVIEW_INTERVAL_DAYS)).toBe(30);
  });

  it('clamps steps into 0..5', () => {
    expect(clampStep(-3)).toBe(0);
    expect(clampStep(9)).toBe(REVIEW_MAX_STEP);
    expect(clampStep(Number.NaN)).toBe(0);
  });
});

describe('newly introduced cards', () => {
  it('starts at step 0 and is immediately due', () => {
    const state = newCardState(T0);
    expect(state.step).toBe(0);
    expect(state.dueAt.getTime()).toBe(T0.getTime());
    expect(state.lastReviewedAt).toBeNull();
  });
});

describe('scheduleReview', () => {
  it('Good advances one step through the whole ladder', () => {
    const expectedDays = [1, 3, 7, 14, 30];
    let step = 0;
    for (const days of expectedDays) {
      const result = scheduleReview({ state: { step }, rating: 'good', acceptedAt: T0 });
      expect(result.step).toBe(step + 1);
      expect(daysBetween(T0, result.dueAt)).toBe(days);
      step = result.step;
    }
    // Capped: a sixth Good keeps step 5 and the 30 day interval.
    const capped = scheduleReview({ state: { step: 5 }, rating: 'good', acceptedAt: T0 });
    expect(capped.step).toBe(5);
    expect(daysBetween(T0, capped.dueAt)).toBe(30);
  });

  it('Easy advances two steps, capped at 5', () => {
    const fromZero = scheduleReview({ state: { step: 0 }, rating: 'easy', acceptedAt: T0 });
    expect(fromZero.step).toBe(2);
    expect(daysBetween(T0, fromZero.dueAt)).toBe(3);

    const nearCap = scheduleReview({ state: { step: 4 }, rating: 'easy', acceptedAt: T0 });
    expect(nearCap.step).toBe(5);
    expect(daysBetween(T0, nearCap.dueAt)).toBe(30);
  });

  it('Hard keeps the step and schedules one day later', () => {
    const result = scheduleReview({ state: { step: 3 }, rating: 'hard', acceptedAt: T0 });
    expect(result.step).toBe(3);
    expect(daysBetween(T0, result.dueAt)).toBe(1);
  });

  it('Again resets to step 0 and schedules ten minutes later', () => {
    const result = scheduleReview({ state: { step: 5 }, rating: 'again', acceptedAt: T0 });
    expect(result.step).toBe(0);
    expect(result.dueAt.getTime() - T0.getTime()).toBe(10 * MS_PER_MINUTE);
  });

  it('forces Again when an objectively graded card was answered incorrectly', () => {
    const result = scheduleReview({
      state: { step: 4 },
      rating: 'easy',
      correctness: false,
      acceptedAt: T0,
    });
    expect(result.effectiveRating).toBe('again');
    expect(result.ratingWasForced).toBe(true);
    expect(result.step).toBe(0);
  });

  it('allows Hard, Good or Easy when the answer was correct', () => {
    for (const rating of ['hard', 'good', 'easy'] as const) {
      const result = scheduleReview({
        state: { step: 1 },
        rating,
        correctness: true,
        acceptedAt: T0,
      });
      expect(result.effectiveRating).toBe(rating);
      expect(result.ratingWasForced).toBe(false);
    }
  });

  it('measures every interval from the server acceptance time, not the client', () => {
    const clock = fixedClock(T0);
    clock.advanceMs(5 * MS_PER_DAY);
    const later = clock.now();
    const result = scheduleReview({ state: { step: 0 }, rating: 'good', acceptedAt: later });
    expect(daysBetween(later, result.dueAt)).toBe(1);
  });
});

describe('due queue ordering', () => {
  it('puts overdue cards before newly introduced ones and hides nothing', () => {
    const now = new Date('2026-09-10T00:00:00.000Z');
    const cards = [
      { cardId: 'fresh-b', step: 0, dueAt: now, lastReviewedAt: null },
      {
        cardId: 'overdue-late',
        step: 2,
        dueAt: new Date('2026-09-09T00:00:00.000Z'),
        lastReviewedAt: T0,
      },
      { cardId: 'fresh-a', step: 0, dueAt: now, lastReviewedAt: null },
      {
        cardId: 'overdue-early',
        step: 1,
        dueAt: new Date('2026-09-08T00:00:00.000Z'),
        lastReviewedAt: T0,
      },
      {
        cardId: 'not-due',
        step: 3,
        dueAt: new Date('2026-09-20T00:00:00.000Z'),
        lastReviewedAt: T0,
      },
    ];
    const ordered = orderDueQueue(cards, now);
    expect(ordered.map((c) => c.cardId)).toEqual([
      'overdue-early',
      'overdue-late',
      'fresh-a',
      'fresh-b',
    ]);
    expect(ordered.some((c) => c.cardId === 'not-due')).toBe(false);
    // The batch is a display size, not a cap that hides remaining work.
    expect(DEFAULT_REVIEW_BATCH).toBe(20);
  });
});
