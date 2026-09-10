import { XP, levelForXp } from '@devpractice/contracts';
import type { Tx } from '../db/client.js';
import type { Clock } from './clock.js';

/**
 * XP awards (spec 3.7).
 *
 * XP is deliberately separate from mastery: it is awarded for a FIRST accepted
 * pass whether assisted or not, and never for opening pages, retrying, importing
 * content, repeated review clicks, manual skips, or placement alone.
 *
 * Duplication is prevented structurally by the unique (userId, awardKey)
 * constraint rather than by a read-then-write check, so a retry can never
 * double-credit even under concurrency.
 */

export const awardKeys = {
  /** Per exercise per mastery revision: new required behaviour earns again. */
  exercisePass: (exerciseId: string, masteryRevision: number) =>
    `exercise:${exerciseId}:r${masteryRevision}`,
  lessonCompletion: (lessonId: string) => `lesson:${lessonId}`,
  missionCompletion: (missionId: string) => `mission:${missionId}`,
} as const;

export interface AwardResult {
  awarded: boolean;
  amount: number;
}

/**
 * Grant XP once. A repeat call with the same key is a silent no-op returning
 * awarded: false, so callers can stay simple.
 */
export async function awardXp(
  tx: Tx,
  clock: Clock,
  userId: string,
  awardKey: string,
  amount: number,
  reason: string,
): Promise<AwardResult> {
  const existing = await tx.xpAward.findUnique({
    where: { userId_awardKey: { userId, awardKey } },
  });
  if (existing) return { awarded: false, amount: 0 };

  try {
    await tx.xpAward.create({
      data: { userId, awardKey, amount, reason, createdAt: clock.now() },
    });
    return { awarded: true, amount };
  } catch {
    // Lost a race against a concurrent identical award; the constraint held.
    return { awarded: false, amount: 0 };
  }
}

export async function totalXp(tx: Tx, userId: string): Promise<number> {
  const result = await tx.xpAward.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

export async function xpSummary(tx: Tx, userId: string): Promise<{ totalXp: number; level: number }> {
  const total = await totalXp(tx, userId);
  return { totalXp: total, level: levelForXp(total) };
}

export { XP };
