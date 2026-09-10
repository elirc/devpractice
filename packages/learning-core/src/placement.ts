/**
 * Placement assessments (spec 3.5).
 *
 * Passing grants placed_out and separate placement evidence. It does NOT claim
 * the owner completed every exercise or retained the material, and manual
 * skipping stays available regardless of the score.
 */

export interface PlacementItemOutcome {
  itemId: string;
  critical: boolean;
  correct: boolean;
}

export interface PlacementRules {
  minimumCorrect: number;
  requireAllCritical: boolean;
}

export const DEFAULT_PLACEMENT_RULES: PlacementRules = {
  minimumCorrect: 4,
  requireAllCritical: true,
};

export interface PlacementResult {
  score: number;
  total: number;
  qualified: boolean;
  failedCriticalItemIds: string[];
}

export function gradePlacement(
  outcomes: PlacementItemOutcome[],
  rules: PlacementRules = DEFAULT_PLACEMENT_RULES,
): PlacementResult {
  const score = outcomes.filter((o) => o.correct).length;
  const failedCriticalItemIds = outcomes
    .filter((o) => o.critical && !o.correct)
    .map((o) => o.itemId);
  const meetsScore = score >= rules.minimumCorrect;
  const meetsCritical = !rules.requireAllCritical || failedCriticalItemIds.length === 0;
  return {
    score,
    total: outcomes.length,
    qualified: meetsScore && meetsCritical,
    failedCriticalItemIds,
  };
}

/**
 * Once answers have been revealed for an assessment VERSION, repeat attempts on
 * that same version are practice only. Fresh placement evidence needs an
 * alternate authored version.
 */
export function isPracticeOnly(previousAttemptsOnVersion: number): boolean {
  return previousAttemptsOnVersion > 0;
}
