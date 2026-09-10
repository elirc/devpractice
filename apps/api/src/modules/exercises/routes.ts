import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { revealBodySchema, type ExerciseItem } from '@devpractice/contracts';
import { requireOwner } from '../../lib/auth-context.js';
import { ok, problem } from '../../lib/errors.js';
import { findReceipt, storeReceipt } from '../../lib/idempotency.js';
import { db, parseBody, parseParams, recordActivity, TX_OPTIONS } from '../curriculum/shared.js';
import { loadItem, requireActiveReleaseId } from '../curriculum/release.js';
import { revealStateFor } from '../lessons/progress-helpers.js';
import { projectExercise } from './projection.js';

const idParamSchema = z.object({ id: z.string().min(1).max(80) });

const REVEAL_OPERATION = 'exercise.reveal';

export function registerExercisesRoutes(app: FastifyInstance): void {
  /**
   * Public exercise payload. Solutions and unrevealed hints are omitted here;
   * they are only obtainable through POST /exercises/:id/reveals, which records
   * the assistance permanently for that mastery revision.
   */
  app.get('/exercises/:id', async (request, reply) => {
    const owner = requireOwner(request);
    const { id } = parseParams(idParamSchema, request);
    const releaseId = await requireActiveReleaseId(db(), owner);

    const exercise = await loadItem<ExerciseItem>(db(), releaseId, id, 'exercise');
    const reveals = await revealStateFor(db(), owner.userId, id, exercise.masteryRevision);

    const draft = await db().exerciseDraft.findUnique({
      where: { userId_exerciseId: { userId: owner.userId, exerciseId: id } },
      select: { source: true, revision: true, contentVersionId: true, updatedAt: true },
    });

    return ok(reply, {
      exercise: projectExercise(
        exercise.payload,
        {
          versionId: exercise.versionId,
          version: exercise.version,
          masteryRevision: exercise.masteryRevision,
        },
        reveals,
      ),
      draft: draft
        ? {
            source: draft.source,
            revision: draft.revision,
            contentVersionId: draft.contentVersionId,
            updatedAt: draft.updatedAt.toISOString(),
            /** The starter changed underneath a saved draft. */
            staleAgainstCurrentVersion: draft.contentVersionId !== exercise.versionId,
          }
        : null,
    });
  });

  /**
   * Reveal a hint or the reference solution. Idempotent: the same clientEventId
   * returns the original result and never records a second reveal.
   */
  app.post('/exercises/:id/reveals', async (request, reply) => {
    const owner = requireOwner(request);
    const { id } = parseParams(idParamSchema, request);
    const body = parseBody(revealBodySchema, request);
    const releaseId = await requireActiveReleaseId(db(), owner);
    const exercise = await loadItem<ExerciseItem>(db(), releaseId, id, 'exercise');

    if (body.revealKind === 'hint') {
      if (body.hintIndex === undefined) throw problem.badRequest('hintIndex is required for a hint reveal.');
      if (body.hintIndex >= exercise.payload.hints.length) throw problem.notFound();
    }

    const result = await db().$transaction(async (tx) => {
      const replay = await findReceipt<Record<string, unknown>>(
        tx,
        owner.userId,
        body.clientEventId,
        REVEAL_OPERATION,
        { exerciseId: id, ...body },
      );
      if (replay.replayed) return replay.response as Record<string, unknown>;

      await tx.revealEvent.create({
        data: {
          userId: owner.userId,
          itemId: id,
          masteryRevision: exercise.masteryRevision,
          revealKind: body.revealKind,
          hintIndex: body.revealKind === 'hint' ? (body.hintIndex ?? null) : null,
          clientEventId: body.clientEventId,
        },
      });

      const payload =
        body.revealKind === 'hint'
          ? {
              revealKind: 'hint' as const,
              hintIndex: body.hintIndex ?? 0,
              text: exercise.payload.hints[body.hintIndex ?? 0] as string,
            }
          : {
              revealKind: 'solution' as const,
              solution: exercise.payload.solution,
              /** Made explicit so the UI never has to guess. */
              notice:
                'This attempt will be recorded as solution-assisted for this version of the exercise.',
            };

      await recordActivity(tx, owner.userId, `exercise.reveal.${body.revealKind}`, id, null, {
        masteryRevision: exercise.masteryRevision,
      });
      await storeReceipt(
        tx,
        owner.userId,
        body.clientEventId,
        REVEAL_OPERATION,
        { exerciseId: id, ...body },
        payload,
      );
      return payload as unknown as Record<string, unknown>;
    }, TX_OPTIONS);

    return ok(reply, result);
  });
}
