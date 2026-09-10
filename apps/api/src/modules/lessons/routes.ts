import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  enrollCardsSchema,
  lessonCompleteSchema,
  lessonSkipSchema,
  type ExerciseItem,
  type LessonItem,
  type ReviewCardItem,
} from '@devpractice/contracts';
import {
  checkLessonCompletion,
  lessonCompletionAward,
  newCardState,
  nextLessonStatus,
  type RequiredExerciseState,
} from '@devpractice/learning-core';
import { requireOwner } from '../../lib/auth-context.js';
import { ok, problem } from '../../lib/errors.js';
import { findReceipt, storeReceipt } from '../../lib/idempotency.js';
import { db, grantXp, parseBody, parseParams, recordActivity, serverNow, TX_OPTIONS } from '../curriculum/shared.js';
import { loadItem, loadItems, requireActiveReleaseId } from '../curriculum/release.js';
import { requiredExercisesForLesson, revealStateFor, updatedPracticeForLessons } from './progress-helpers.js';

const idParamSchema = z.object({ id: z.string().min(1).max(80) });

export function registerLessonsRoutes(app: FastifyInstance): void {
  app.get('/lessons/:id', async (request, reply) => {
    const owner = requireOwner(request);
    const { id } = parseParams(idParamSchema, request);
    const releaseId = await requireActiveReleaseId(db(), owner);

    const lesson = await loadItem<LessonItem>(db(), releaseId, id, 'lesson');
    const exercises = await loadItems<ExerciseItem>(
      db(),
      releaseId,
      lesson.payload.exerciseIds,
      'exercise',
    );

    const [progress, updated, attempts] = await Promise.all([
      db().lessonProgress.findUnique({
        where: { userId_lessonId: { userId: owner.userId, lessonId: id } },
      }),
      updatedPracticeForLessons(db(), owner.userId, releaseId, [lesson.payload]),
      db().attempt.findMany({
        where: { userId: owner.userId, exerciseId: { in: lesson.payload.exerciseIds } },
        orderBy: { createdAt: 'desc' },
        select: {
          exerciseId: true,
          masteryRevision: true,
          outcome: true,
          assistance: true,
          gradingOrigin: true,
          createdAt: true,
        },
      }),
    ]);

    const latestByExercise = new Map<string, (typeof attempts)[number]>();
    for (const attempt of attempts) {
      if (!latestByExercise.has(attempt.exerciseId)) latestByExercise.set(attempt.exerciseId, attempt);
    }

    const enrolled = await db().reviewState.findMany({
      where: { userId: owner.userId, cardId: { in: lesson.payload.reviewCardIds } },
      select: { cardId: true },
    });

    return ok(reply, {
      id: lesson.itemId,
      title: lesson.title,
      chapterId: lesson.payload.chapterId,
      versionId: lesson.versionId,
      bodyMarkdown: lesson.payload.bodyMarkdown,
      objectives: lesson.payload.objectives,
      estimatedMinutes: lesson.payload.estimatedMinutes,
      workedExampleMarkdown: lesson.payload.workedExampleMarkdown,
      commonMistakes: lesson.payload.commonMistakes,
      summaryMarkdown: lesson.payload.summaryMarkdown,
      references: lesson.payload.references,
      conceptIds: lesson.payload.conceptIds,
      status: progress?.status ?? 'not_started',
      completedAt: progress?.completedAt?.toISOString() ?? null,
      updatedPracticeAvailable: updated.get(id) ?? false,
      reviewCardsEnrolled: enrolled.length > 0,
      reviewCardIds: lesson.payload.reviewCardIds,
      exercises: exercises.map((e) => {
        const latest = latestByExercise.get(e.itemId);
        return {
          id: e.itemId,
          versionId: e.versionId,
          title: e.title,
          type: e.payload.type,
          difficulty: e.payload.difficulty,
          estimatedMinutes: e.payload.estimatedMinutes,
          requiredForLessonCompletion: e.payload.requiredForLessonCompletion,
          masteryRevision: e.masteryRevision,
          latestAttempt: latest
            ? {
                outcome: latest.outcome,
                assistance: latest.assistance,
                gradingOrigin: latest.gradingOrigin,
                masteryRevision: latest.masteryRevision,
                createdAt: latest.createdAt.toISOString(),
              }
            : null,
        };
      }),
    });
  });

  /**
   * Explicit lesson completion: reading acknowledged AND every required
   * objective satisfied at the CURRENT mastery revision. Rubric exercises are
   * satisfied by a recorded self-assessment, never by an automated grade.
   */
  app.post('/lessons/:id/complete', async (request, reply) => {
    const owner = requireOwner(request);
    const { id } = parseParams(idParamSchema, request);
    const body = parseBody(lessonCompleteSchema, request);
    const releaseId = await requireActiveReleaseId(db(), owner);
    const lesson = await loadItem<LessonItem>(db(), releaseId, id, 'lesson');
    const required = (await requiredExercisesForLesson(db(), releaseId, lesson.payload)).filter(
      (e) => e.requiredForLessonCompletion,
    );

    const attempts = await db().attempt.findMany({
      where: {
        userId: owner.userId,
        exerciseId: { in: required.map((r) => r.exerciseId) },
      },
      select: { exerciseId: true, masteryRevision: true, outcome: true, result: true },
    });

    const states: RequiredExerciseState[] = required.map((r) => {
      const mine = attempts.filter(
        (a) => a.exerciseId === r.exerciseId && a.masteryRevision === r.masteryRevision,
      );
      const isRubric = r.type === 'explanation' || r.type === 'local-project';
      return {
        exerciseId: r.exerciseId,
        masteryRevision: r.masteryRevision,
        requiresSelfAssessment: isRubric,
        hasPassingAttempt: mine.some((a) => a.outcome === 'passed'),
        hasSelfAssessment: mine.some(
          (a) =>
            a.outcome !== 'needs_self_assessment' &&
            typeof (a.result as Record<string, unknown> | null)?.selfAssessment === 'string',
        ),
      };
    });

    const check = checkLessonCompletion(states, body.acknowledgedReading);
    if (!check.satisfied) {
      throw problem.badRequest('This lesson still has required practice outstanding.', {
        exercises: check.missingExerciseIds,
      });
    }

    const result = await db().$transaction(async (tx) => {
      const replay = await findReceipt<Record<string, unknown>>(
        tx,
        owner.userId,
        body.clientEventId,
        'lesson.complete',
        { lessonId: id, ...body },
      );
      if (replay.replayed && replay.response) return replay.response;

      const existing = await tx.lessonProgress.findUnique({
        where: { userId_lessonId: { userId: owner.userId, lessonId: id } },
      });
      const now = serverNow();
      const status = nextLessonStatus(existing?.status ?? 'not_started', 'complete');

      const progress = await tx.lessonProgress.upsert({
        where: { userId_lessonId: { userId: owner.userId, lessonId: id } },
        create: {
          userId: owner.userId,
          lessonId: id,
          status,
          startedAt: existing?.startedAt ?? now,
          completedAt: now,
        },
        update: {
          status,
          completedAt: existing?.completedAt ?? now,
          version: { increment: 1 },
        },
      });

      const xpAwarded = await grantXp(tx, owner.userId, lessonCompletionAward(id));
      await recordActivity(tx, owner.userId, 'lesson.completed', id, null, { xpAwarded });

      const payload = {
        lessonId: id,
        status: progress.status,
        completedAt: progress.completedAt?.toISOString() ?? now.toISOString(),
        xpAwarded,
      };
      await storeReceipt(
        tx,
        owner.userId,
        body.clientEventId,
        'lesson.complete',
        { lessonId: id, ...body },
        payload,
      );
      return payload as unknown as Record<string, unknown>;
    }, TX_OPTIONS);

    return ok(reply, result);
  });

  /**
   * Enrol this lesson's review cards. Importing content never enrols cards;
   * this is the explicit act. It does not change lesson completion.
   */
  app.post('/lessons/:id/review-cards', async (request, reply) => {
    const owner = requireOwner(request);
    const { id } = parseParams(idParamSchema, request);
    const body = parseBody(enrollCardsSchema, request);
    const releaseId = await requireActiveReleaseId(db(), owner);
    const lesson = await loadItem<LessonItem>(db(), releaseId, id, 'lesson');
    const cards = await loadItems<ReviewCardItem>(
      db(),
      releaseId,
      lesson.payload.reviewCardIds,
      'review_card',
    );

    const result = await db().$transaction(async (tx) => {
      const replay = await findReceipt<Record<string, unknown>>(
        tx,
        owner.userId,
        body.clientEventId,
        'lesson.enrol-cards',
        { lessonId: id, ...body },
      );
      if (replay.replayed && replay.response) return replay.response;

      const now = serverNow();
      const created = await tx.reviewState.createMany({
        data: cards.map((card) => {
          const state = newCardState(now);
          return {
            userId: owner.userId,
            cardId: card.itemId,
            step: state.step,
            dueAt: state.dueAt,
          };
        }),
        skipDuplicates: true,
      });

      const payload = { lessonId: id, enrolled: created.count, cardIds: cards.map((c) => c.itemId) };
      await storeReceipt(
        tx,
        owner.userId,
        body.clientEventId,
        'lesson.enrol-cards',
        { lessonId: id, ...body },
        payload,
      );
      return payload as unknown as Record<string, unknown>;
    }, TX_OPTIONS);

    return ok(reply, result);
  });

  /** Skipping records status only. Prior evidence and XP are untouched. */
  app.post('/lessons/:id/skip', async (request, reply) => {
    const owner = requireOwner(request);
    const { id } = parseParams(idParamSchema, request);
    const body = parseBody(lessonSkipSchema, request);
    const releaseId = await requireActiveReleaseId(db(), owner);
    await loadItem<LessonItem>(db(), releaseId, id, 'lesson');

    const result = await db().$transaction(async (tx) => {
      const replay = await findReceipt<Record<string, unknown>>(
        tx,
        owner.userId,
        body.clientEventId,
        'lesson.skip',
        { lessonId: id, ...body },
      );
      if (replay.replayed && replay.response) return replay.response;

      const existing = await tx.lessonProgress.findUnique({
        where: { userId_lessonId: { userId: owner.userId, lessonId: id } },
      });
      // Completion is monotonic: skipping a completed lesson changes nothing.
      const status = nextLessonStatus(existing?.status ?? 'not_started', 'skip');
      const progress = await tx.lessonProgress.upsert({
        where: { userId_lessonId: { userId: owner.userId, lessonId: id } },
        create: { userId: owner.userId, lessonId: id, status, startedAt: serverNow() },
        update: { status, version: { increment: 1 } },
      });

      await recordActivity(tx, owner.userId, 'lesson.skipped', id, null);
      const payload = { lessonId: id, status: progress.status, xpAwarded: 0 };
      await storeReceipt(
        tx,
        owner.userId,
        body.clientEventId,
        'lesson.skip',
        { lessonId: id, ...body },
        payload,
      );
      return payload as unknown as Record<string, unknown>;
    }, TX_OPTIONS);

    return ok(reply, result);
  });
}

export { revealStateFor };
