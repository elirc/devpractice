import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { reviewResponseSchema, type ReviewCardItem } from '@devpractice/contracts';
import {
  DEFAULT_REVIEW_BATCH,
  gradeChoice,
  orderDueQueue,
  scheduleReview,
  type ChoiceGrading,
} from '@devpractice/learning-core';
import { requireOwner } from '../../lib/auth-context.js';
import { ok, problem } from '../../lib/errors.js';
import { findReceipt, storeReceipt } from '../../lib/idempotency.js';
import { db, parseBody, parseParams, parseQuery, recordActivity, serverNow, TX_OPTIONS } from '../curriculum/shared.js';
import { loadItems, loadPublishedVersion, requireActiveReleaseId } from '../curriculum/release.js';

const cardParamSchema = z.object({ cardId: z.string().min(1).max(80) });
const dueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_REVIEW_BATCH),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export function registerReviewsRoutes(app: FastifyInstance): void {
  /**
   * The due queue: overdue cards first, then newly introduced ones.
   * `limit` is a visible batch size with an explicit continue, not a daily cap
   * that hides remaining work (spec 3.6).
   */
  app.get('/reviews/due', async (request, reply) => {
    const owner = requireOwner(request);
    const { limit, offset } = parseQuery(dueQuerySchema, request);
    const releaseId = await requireActiveReleaseId(db(), owner);
    const now = serverNow();

    const states = await db().reviewState.findMany({
      where: { userId: owner.userId, dueAt: { lte: now } },
      select: { cardId: true, step: true, dueAt: true, lastReviewedAt: true, revision: true },
    });

    const ordered = orderDueQueue(states, now);
    const page = ordered.slice(offset, offset + limit);
    const cards = await loadItems<ReviewCardItem>(
      db(),
      releaseId,
      page.map((c) => c.cardId),
      'review_card',
    );
    const byId = new Map(cards.map((c) => [c.itemId, c]));

    return ok(
      reply,
      page.flatMap((state) => {
        const card = byId.get(state.cardId);
        // A card whose content was archived is skipped rather than crashing.
        if (!card) return [];
        return [
          {
            cardId: state.cardId,
            cardVersionId: card.versionId,
            title: card.title,
            promptMarkdown: card.payload.promptMarkdown,
            type: card.payload.type,
            gradingOrigin: card.payload.gradingOrigin,
            primaryConceptId: card.payload.primaryConceptId,
            // Objectively graded cards ship their options; free-recall cards
            // reveal the answer only after the learner asks.
            options:
              card.payload.grading?.options.map((o) => ({ id: o.id, textMarkdown: o.textMarkdown })) ??
              null,
            step: state.step,
            dueAt: state.dueAt.toISOString(),
            revision: state.revision,
          },
        ];
      }),
      {
        serverTime: now.toISOString(),
        totalDue: ordered.length,
        returned: page.length,
        hasMore: offset + page.length < ordered.length,
        nextOffset: offset + page.length,
        batchSize: limit,
      },
    );
  });

  /**
   * Record one review response. Version-checked so a second device holding a
   * stale card revision cannot move the schedule twice, and idempotent so a
   * network retry returns the original result (acceptance A05).
   */
  app.post('/reviews/:cardId/responses', async (request, reply) => {
    const owner = requireOwner(request);
    const { cardId } = parseParams(cardParamSchema, request);
    const body = parseBody(reviewResponseSchema, request);

    const version = await loadPublishedVersion<ReviewCardItem>(
      db(),
      body.cardVersionId,
      owner.activeReleaseId,
    );
    if (version.kind !== 'review_card' || version.itemId !== cardId) throw problem.notFound();

    const card = version.payload;

    // Objective correctness is decided by the server; an incorrect answer
    // forces Again no matter what the client submitted.
    let correctness: boolean | null = null;
    let gradingOrigin: 'server_objective' | 'self_reported' = 'self_reported';
    if (card.gradingOrigin === 'server_objective' && card.grading) {
      if (!body.selectedOptionIds) {
        throw problem.badRequest('This card is objectively graded; selectedOptionIds is required.');
      }
      correctness = gradeChoice(card.grading as unknown as ChoiceGrading, body.selectedOptionIds).correct;
      gradingOrigin = 'server_objective';
    }

    const result = await db().$transaction(async (tx) => {
      const replay = await findReceipt<Record<string, unknown>>(
        tx,
        owner.userId,
        body.clientEventId,
        'review.respond',
        { cardId, ...body },
      );
      if (replay.replayed && replay.response) return replay.response;

      const state = await tx.reviewState.findUnique({
        where: { userId_cardId: { userId: owner.userId, cardId } },
      });
      if (!state) throw problem.notFound('That card is not enrolled for review.');

      if (state.revision !== body.expectedRevision) {
        throw problem.revisionConflict('This card was already reviewed on another device.', {
          serverRevision: state.revision,
          serverState: {
            step: state.step,
            dueAt: state.dueAt.toISOString(),
            lastReviewedAt: state.lastReviewedAt?.toISOString() ?? null,
          },
        });
      }

      const now = serverNow();
      const wasDue = state.dueAt.getTime() <= now.getTime();
      const scheduled = scheduleReview({
        state: { step: state.step },
        rating: body.rating,
        correctness,
        acceptedAt: now,
      });

      const updated = await tx.reviewState.update({
        where: { userId_cardId: { userId: owner.userId, cardId } },
        data: {
          step: scheduled.step,
          dueAt: scheduled.dueAt,
          lastReviewedAt: scheduled.lastReviewedAt,
          revision: { increment: 1 },
        },
      });

      const event = await tx.reviewEvent.create({
        data: {
          userId: owner.userId,
          cardId,
          cardVersionId: version.versionId,
          clientEventId: body.clientEventId,
          rating: scheduled.effectiveRating,
          correctness,
          gradingOrigin,
          fromRevision: state.revision,
        },
      });

      // `wasDue` is retention-relevant but has no column on ReviewEvent, so it
      // is recorded here against the event id and read back by /progress.
      await recordActivity(tx, owner.userId, 'review.answered', cardId, event.id, {
        rating: scheduled.effectiveRating,
        correctness,
        wasDue,
      });

      const payload = {
        cardId,
        step: updated.step,
        dueAt: updated.dueAt.toISOString(),
        lastReviewedAt: updated.lastReviewedAt?.toISOString() ?? null,
        revision: updated.revision,
        effectiveRating: scheduled.effectiveRating,
        ratingWasForced: scheduled.ratingWasForced,
        correctness,
        gradingOrigin,
        wasDue,
        answerMarkdown: card.answerMarkdown,
        explanationMarkdown: card.explanationMarkdown,
        // Repeated review clicks never earn XP (spec 3.7).
        xpAwarded: 0,
      };
      await storeReceipt(
        tx,
        owner.userId,
        body.clientEventId,
        'review.respond',
        { cardId, ...body },
        payload,
      );
      return payload as unknown as Record<string, unknown>;
    }, TX_OPTIONS);

    return ok(reply, result);
  });
}
