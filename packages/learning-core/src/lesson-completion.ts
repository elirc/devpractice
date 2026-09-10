import type { LessonStatus } from '@devpractice/contracts';

/**
 * Lesson completion and status transitions (spec 3.4, 9.4).
 *
 * Lesson STATUS and exercise EVIDENCE are separate records. Completion is
 * monotonic: ordinary synchronisation can never revert completed, and skipping
 * an already completed lesson leaves it completed.
 */

export interface RequiredExerciseState {
  exerciseId: string;
  masteryRevision: number;
  /** Rubric exercises need a self-assessment rather than an objective pass. */
  requiresSelfAssessment: boolean;
  hasPassingAttempt: boolean;
  hasSelfAssessment: boolean;
}

export interface CompletionCheck {
  satisfied: boolean;
  missingExerciseIds: string[];
}

export function checkLessonCompletion(
  required: RequiredExerciseState[],
  acknowledgedReading: boolean,
): CompletionCheck {
  const missing = required
    .filter((r) => (r.requiresSelfAssessment ? !r.hasSelfAssessment : !r.hasPassingAttempt))
    .map((r) => r.exerciseId);
  return { satisfied: acknowledgedReading && missing.length === 0, missingExerciseIds: missing };
}

/** Completion never regresses; skip only applies to a not-yet-completed lesson. */
export function nextLessonStatus(current: LessonStatus, action: 'start' | 'complete' | 'skip'): LessonStatus {
  if (current === 'completed') return 'completed';
  switch (action) {
    case 'start':
      return current === 'not_started' ? 'in_progress' : current;
    case 'complete':
      return 'completed';
    case 'skip':
      return 'skipped';
  }
}

/**
 * A completed lesson whose required exercises moved to a NEW mastery revision
 * shows "updated practice available". The original completion stands; the new
 * practice earns its own evidence rather than rewriting history.
 */
export function hasUpdatedPractice(
  completedAgainst: { exerciseId: string; masteryRevision: number }[],
  current: { exerciseId: string; masteryRevision: number }[],
): boolean {
  const previous = new Map(completedAgainst.map((e) => [e.exerciseId, e.masteryRevision]));
  return current.some((e) => {
    const before = previous.get(e.exerciseId);
    return before !== undefined && e.masteryRevision > before;
  });
}
