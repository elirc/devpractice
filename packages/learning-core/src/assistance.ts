import type { Assistance } from '@devpractice/contracts';

/**
 * Assistance rules (spec 3.4, acceptance A06).
 *
 * Assistance is captured on the attempt, and the lifetime reveal history is
 * retained for transparency. Resetting the editor does not launder an assisted
 * attempt into independent evidence.
 */

export interface RevealRecord {
  itemId: string;
  masteryRevision: number;
  revealKind: 'hint' | 'solution';
  hintIndex: number | null;
  createdAt: Date;
}

export interface RevealHistory {
  hintRevealed: boolean;
  solutionRevealed: boolean;
  hintIndexesRevealed: number[];
}

export function summariseReveals(
  reveals: RevealRecord[],
  itemId: string,
  masteryRevision: number,
): RevealHistory {
  const scoped = reveals.filter(
    (r) => r.itemId === itemId && r.masteryRevision === masteryRevision,
  );
  const hintIndexes = scoped
    .filter((r) => r.revealKind === 'hint' && r.hintIndex !== null)
    .map((r) => r.hintIndex as number);
  return {
    hintRevealed: scoped.some((r) => r.revealKind === 'hint'),
    solutionRevealed: scoped.some((r) => r.revealKind === 'solution'),
    hintIndexesRevealed: [...new Set(hintIndexes)].sort((a, b) => a - b),
  };
}

/**
 * The assistance level an attempt is recorded with.
 *
 * A solution reveal for the same (item, masteryRevision) outranks hints and is
 * permanent for that revision: a later pass on the SAME item is still
 * solution-assisted. Fresh independent evidence has to come from a different
 * authored variant or a placement item.
 */
export function resolveAssistance(history: RevealHistory): Assistance {
  if (history.solutionRevealed) return 'solution_viewed';
  if (history.hintRevealed) return 'hints';
  return 'none';
}

export function assistanceForAttempt(
  reveals: RevealRecord[],
  itemId: string,
  masteryRevision: number,
): Assistance {
  return resolveAssistance(summariseReveals(reveals, itemId, masteryRevision));
}

/** True when this attempt can count toward independent mastery evidence. */
export function isIndependent(assistance: Assistance): boolean {
  return assistance === 'none';
}
