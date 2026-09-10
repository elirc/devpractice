import type { FastifyInstance } from 'fastify';
import type { ExerciseItem, ProgressSummaryDto, ReviewCardItem } from '@devpractice/contracts';
import { levelForXp } from '@devpractice/contracts';
import {
  classifyAllConcepts,
  type EvidenceAttempt,
  type EvidenceReview,
  type ExerciseType,
} from '@devpractice/learning-core';
import { requireOwner } from '../../lib/auth-context.js';
import { ok } from '../../lib/errors.js';
import { db, serverNow } from '../curriculum/shared.js';
import { listCatalog, loadItems, requireActiveReleaseId } from '../curriculum/release.js';

/**
 * Progress and concept evidence (spec 9.2).
 *
 * Everything here is derived from the owner's real records: attempts, reveals,
 * reviews, placements and XP awards. Nothing is invented, and each figure keeps
 * its grading origin so browser-checked and self-reported work stay
 * distinguishable from server-checked work.
 */
export function registerProgressRoutes(app: FastifyInstance): void {
  app.get('/progress', async (request, reply) => {
    const owner = requireOwner(request);
    const releaseId = await requireActiveReleaseId(db(), owner);
    const now = serverNow();

    const [exerciseRows, cardRows] = await Promise.all([
      listCatalog(db(), releaseId, 'exercise'),
      listCatalog(db(), releaseId, 'review_card'),
    ]);

    const [exercises, cards] = await Promise.all([
      loadItems<ExerciseItem>(db(), releaseId, exerciseRows.map((r) => r.itemId), 'exercise'),
      loadItems<ReviewCardItem>(db(), releaseId, cardRows.map((r) => r.itemId), 'review_card'),
    ]);

    const exerciseMeta = new Map(
      exercises.map((e) => [
        e.itemId,
        { type: e.payload.type as ExerciseType, conceptId: e.payload.primaryConceptId },
      ]),
    );
    const cardConcept = new Map(cards.map((c) => [c.itemId, c.payload.primaryConceptId]));

    const [attempts, reviewEvents, reviewStates, lessonProgress, placements, xpAwards, reveals] =
      await Promise.all([
        db().attempt.findMany({
          where: { userId: owner.userId },
          select: {
            exerciseId: true,
            masteryRevision: true,
            outcome: true,
            gradingOrigin: true,
            assistance: true,
            createdAt: true,
          },
        }),
        db().reviewEvent.findMany({
          where: { userId: owner.userId },
          select: {
            id: true,
            cardId: true,
            correctness: true,
            gradingOrigin: true,
            rating: true,
            createdAt: true,
          },
        }),
        db().reviewState.findMany({
          where: { userId: owner.userId },
          select: { cardId: true, dueAt: true },
        }),
        db().lessonProgress.findMany({
          where: { userId: owner.userId },
          select: { lessonId: true, status: true },
        }),
        db().chapterPlacement.findMany({
          where: { userId: owner.userId, placedOut: true },
          select: { chapterId: true, qualifiedAt: true },
        }),
        db().xpAward.findMany({
          where: { userId: owner.userId },
          select: { amount: true, reason: true },
        }),
        db().revealEvent.findMany({
          where: { userId: owner.userId },
          select: { revealKind: true },
        }),
      ]);

    const missionsCompleted = await db().missionProgress.count({
      where: { userId: owner.userId, status: 'completed' },
    });

    const evidenceAttempts: EvidenceAttempt[] = attempts.flatMap((a) => {
      const meta = exerciseMeta.get(a.exerciseId);
      if (!meta) return [];
      return [
        {
          itemId: a.exerciseId,
          masteryRevision: a.masteryRevision,
          conceptId: meta.conceptId,
          exerciseType: meta.type,
          outcome: a.outcome,
          gradingOrigin: a.gradingOrigin,
          assistance: a.assistance,
          createdAt: a.createdAt,
        },
      ];
    });

    // A review counts toward retention only if the card was genuinely due when
    // it was answered. That fact is captured at response time on the matching
    // activity row (ReviewEvent has no column for it); a review with no such
    // record is treated conservatively as NOT due, so it cannot inflate a
    // retention claim.
    const dueAtByCard = new Map(reviewStates.map((s) => [s.cardId, s.dueAt]));
    const reviewActivity = await db().activityEvent.findMany({
      where: { userId: owner.userId, kind: 'review.answered' },
      select: { relatedRecordId: true, detail: true },
    });
    const wasDueByEventId = new Map<string, boolean>();
    for (const row of reviewActivity) {
      if (!row.relatedRecordId) continue;
      const detail = row.detail as { wasDue?: unknown } | null;
      wasDueByEventId.set(row.relatedRecordId, detail?.wasDue === true);
    }

    const evidenceReviews: EvidenceReview[] = reviewEvents.flatMap((e) => {
      const conceptId = cardConcept.get(e.cardId);
      if (!conceptId) return [];
      return [
        {
          conceptId,
          cardId: e.cardId,
          correctness: e.correctness,
          gradingOrigin: e.gradingOrigin,
          wasDue: wasDueByEventId.get(e.id) ?? false,
          createdAt: e.createdAt,
        },
      ];
    });

    const conceptIds = [
      ...new Set([...exerciseMeta.values()].map((m) => m.conceptId).concat([...cardConcept.values()])),
    ].sort();

    const schedules = conceptIds.map((conceptId) => {
      const cardIds = [...cardConcept.entries()]
        .filter(([, c]) => c === conceptId)
        .map(([id]) => id);
      const dues = cardIds
        .map((id) => dueAtByCard.get(id))
        .filter((d): d is Date => d instanceof Date)
        .sort((a, b) => a.getTime() - b.getTime());
      return { conceptId, nextDueAt: dues[0] ?? null };
    });

    const concepts = classifyAllConcepts(
      conceptIds,
      evidenceAttempts,
      evidenceReviews,
      schedules,
      now,
    );

    const totalXp = xpAwards.reduce((sum, a) => sum + a.amount, 0);
    const reviewsDue = reviewStates.filter((s) => s.dueAt.getTime() <= now.getTime()).length;

    const summary: ProgressSummaryDto = {
      totalXp,
      level: levelForXp(totalXp),
      lessonsCompleted: lessonProgress.filter((l) => l.status === 'completed').length,
      lessonsSkipped: lessonProgress.filter((l) => l.status === 'skipped').length,
      chaptersPlacedOut: placements.length,
      missionsCompleted,
      reviewsDue,
      concepts: concepts.map((c) => ({
        conceptId: c.conceptId,
        title: c.conceptId,
        status: c.status,
        independentPasses: c.independentPasses,
        assistedPasses: c.assistedPasses,
        applicationOrDebugPasses: c.applicationOrDebugPasses,
        successfulReviewDates: c.successfulReviewDates,
        nextDueAt: c.nextDueAt ? c.nextDueAt.toISOString() : null,
      })),
      assistance: {
        solutionRevealCount: reveals.filter((r) => r.revealKind === 'solution').length,
        hintRevealCount: reveals.filter((r) => r.revealKind === 'hint').length,
      },
    };

    return ok(reply, summary, {
      serverTime: now.toISOString(),
      placedOutChapterIds: placements.map((p) => p.chapterId),
      xpByReason: xpAwards.reduce<Record<string, number>>((acc, a) => {
        acc[a.reason] = (acc[a.reason] ?? 0) + a.amount;
        return acc;
      }, {}),
      note: 'Mastery labels are transparent product heuristics, not validated measurements of competence.',
    });
  });
}
