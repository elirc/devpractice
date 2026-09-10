import type { LessonStatus as PrismaLessonStatus } from '@prisma/client';
import type { ExerciseItem, LessonItem, LessonStatus } from '@devpractice/contracts';
import type { Tx } from '../../db/client.js';
import { loadItems } from '../curriculum/release.js';

/** Shared lesson/exercise progress lookups used across the learning modules. */

export async function lessonStatusMap(
  tx: Tx,
  userId: string,
): Promise<Map<string, LessonStatus>> {
  const rows = await tx.lessonProgress.findMany({
    where: { userId },
    select: { lessonId: true, status: true },
  });
  return new Map(rows.map((r) => [r.lessonId, r.status as PrismaLessonStatus as LessonStatus]));
}

export interface RequiredExerciseSnapshot {
  exerciseId: string;
  versionId: string;
  masteryRevision: number;
  type: ExerciseItem['type'];
  requiredForLessonCompletion: boolean;
  primaryConceptId: string;
}

export async function requiredExercisesForLesson(
  tx: Tx,
  releaseId: string,
  lesson: LessonItem,
): Promise<RequiredExerciseSnapshot[]> {
  const exercises = await loadItems<ExerciseItem>(tx, releaseId, lesson.exerciseIds, 'exercise');
  return exercises.map((e) => ({
    exerciseId: e.itemId,
    versionId: e.versionId,
    masteryRevision: e.masteryRevision,
    type: e.payload.type,
    requiredForLessonCompletion: e.payload.requiredForLessonCompletion,
    primaryConceptId: e.payload.primaryConceptId,
  }));
}

/**
 * "Updated practice available" without storing a completion snapshot.
 *
 * The mastery revision a lesson was completed AGAINST is recoverable from the
 * learner's own passing attempts: the highest revision they ever passed for
 * each required exercise. If the published revision has moved beyond that, new
 * practice exists — and it will earn its own evidence rather than rewriting the
 * original completion (spec 8.2).
 */
export async function updatedPracticeForLessons(
  tx: Tx,
  userId: string,
  releaseId: string,
  lessons: LessonItem[],
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (lessons.length === 0) return result;

  const allExerciseIds = lessons.flatMap((l) => l.exerciseIds);
  const [exercises, progress, attempts] = await Promise.all([
    loadItems<ExerciseItem>(tx, releaseId, allExerciseIds, 'exercise'),
    tx.lessonProgress.findMany({
      where: { userId, lessonId: { in: lessons.map((l) => l.id) }, status: 'completed' },
      select: { lessonId: true },
    }),
    tx.attempt.findMany({
      where: { userId, exerciseId: { in: allExerciseIds }, outcome: 'passed' },
      select: { exerciseId: true, masteryRevision: true },
    }),
  ]);

  const completedLessons = new Set(progress.map((p) => p.lessonId));
  const publishedRevision = new Map(exercises.map((e) => [e.itemId, e.masteryRevision]));
  const passedRevision = new Map<string, number>();
  for (const attempt of attempts) {
    const best = passedRevision.get(attempt.exerciseId) ?? 0;
    if (attempt.masteryRevision > best) passedRevision.set(attempt.exerciseId, attempt.masteryRevision);
  }

  for (const lesson of lessons) {
    if (!completedLessons.has(lesson.id)) {
      result.set(lesson.id, false);
      continue;
    }
    const moved = lesson.exerciseIds.some((id) => {
      const published = publishedRevision.get(id);
      const passed = passedRevision.get(id);
      return published !== undefined && passed !== undefined && published > passed;
    });
    result.set(lesson.id, moved);
  }
  return result;
}

/** Reveal history for one exercise at one mastery revision. */
export async function revealStateFor(
  tx: Tx,
  userId: string,
  itemId: string,
  masteryRevision: number,
): Promise<{ hintIndexes: number[]; solutionRevealed: boolean }> {
  const rows = await tx.revealEvent.findMany({
    where: { userId, itemId, masteryRevision },
    select: { revealKind: true, hintIndex: true },
  });
  return {
    hintIndexes: [
      ...new Set(
        rows
          .filter((r) => r.revealKind === 'hint' && r.hintIndex !== null)
          .map((r) => r.hintIndex as number),
      ),
    ].sort((a, b) => a - b),
    solutionRevealed: rows.some((r) => r.revealKind === 'solution'),
  };
}
