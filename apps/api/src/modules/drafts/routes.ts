import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { draftPutSchema } from '@devpractice/contracts';
import type { Tx } from '../../db/client.js';
import { requireOwner } from '../../lib/auth-context.js';
import { ok, problem } from '../../lib/errors.js';
import { assertByteLimit, parseOrThrow } from '../../lib/validate.js';

const exerciseParamsSchema = z.object({ exerciseId: z.string().min(1).max(80) });

interface DraftDto {
  exerciseId: string;
  source: string;
  revision: number;
  contentVersionId: string;
  updatedAt: string;
}

/**
 * Editor drafts (spec 9.4).
 *
 * Every write carries expectedRevision. There is NO last-write-wins path: a
 * stale save is refused and handed the server's text so the client can keep
 * both versions and let the owner choose. The previous source is snapshotted
 * before each overwrite, so a mistaken save stays recoverable.
 */
export async function registerDraftsRoutes(app: FastifyInstance): Promise<void> {
  const { config, db, clock } = app.deps;

  app.get('/drafts/:exerciseId', async (request, reply) => {
    const owner = requireOwner(request);
    const { exerciseId } = parseOrThrow(exerciseParamsSchema, request.params);

    const draft = await db.exerciseDraft.findUnique({
      where: { userId_exerciseId: { userId: owner.userId, exerciseId } },
    });

    if (!draft) {
      // Revision 0 means "no draft yet"; the client sends it back to create one.
      return ok(reply, { exerciseId, source: null, revision: 0, contentVersionId: null });
    }

    return ok(reply, toDto(draft));
  });

  app.put('/drafts/:exerciseId', async (request, reply) => {
    const owner = requireOwner(request);
    const { exerciseId } = parseOrThrow(exerciseParamsSchema, request.params);

    // Size check BEFORE expensive work (spec 8.3).
    const rawSource = (request.body as { source?: unknown } | undefined)?.source;
    if (typeof rawSource === 'string') {
      assertByteLimit(rawSource, config.limits.draftMaxBytes, 'Draft source');
    }
    const body = parseOrThrow(draftPutSchema, request.body);

    const version = await db.contentVersion.findUnique({ where: { id: body.contentVersionId } });
    if (!version || version.itemId !== exerciseId) {
      throw problem.badRequest('Draft content version does not belong to that exercise.');
    }

    const saved = await db.$transaction(async (tx) => {
      const existing = await tx.exerciseDraft.findUnique({
        where: { userId_exerciseId: { userId: owner.userId, exerciseId } },
      });

      if (!existing) {
        if (body.expectedRevision !== 0) {
          throw problem.revisionConflict('This draft no longer exists on the server.', {
            server: null,
            serverRevision: 0,
            serverUpdatedAt: clock.now().toISOString(),
          });
        }
        const now = clock.now();
        return tx.exerciseDraft.create({
          data: {
            userId: owner.userId,
            exerciseId,
            contentVersionId: body.contentVersionId,
            source: body.source,
            revision: 1,
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      if (existing.revision !== body.expectedRevision) {
        throw problem.revisionConflict('This exercise was edited on another device.', {
          server: toDto(existing),
          serverRevision: existing.revision,
          serverUpdatedAt: existing.updatedAt.toISOString(),
        });
      }

      // Preserve what we are about to replace, then bound the history.
      await tx.draftSnapshot.create({
        data: {
          draftId: existing.id,
          source: existing.source,
          baseRevision: existing.revision,
          reason: 'autosave',
          createdAt: clock.now(),
        },
      });
      await pruneSnapshots(tx, existing.id, config.limits.maxDraftSnapshots);

      return tx.exerciseDraft.update({
        where: { id: existing.id },
        data: {
          source: body.source,
          contentVersionId: body.contentVersionId,
          revision: { increment: 1 },
          updatedAt: clock.now(),
        },
      });
    });

    return ok(reply, toDto(saved));
  });

  app.get('/drafts/:exerciseId/snapshots', async (request, reply) => {
    const owner = requireOwner(request);
    const { exerciseId } = parseOrThrow(exerciseParamsSchema, request.params);

    const draft = await db.exerciseDraft.findUnique({
      where: { userId_exerciseId: { userId: owner.userId, exerciseId } },
      select: { id: true },
    });
    if (!draft) return ok(reply, []);

    const snapshots = await db.draftSnapshot.findMany({
      where: { draftId: draft.id },
      orderBy: { createdAt: 'desc' },
      take: config.limits.maxDraftSnapshots,
    });

    return ok(
      reply,
      snapshots.map((s) => ({
        id: s.id,
        source: s.source,
        baseRevision: s.baseRevision,
        reason: s.reason,
        createdAt: s.createdAt.toISOString(),
      })),
    );
  });
}

function toDto(draft: {
  exerciseId: string;
  source: string;
  revision: number;
  contentVersionId: string;
  updatedAt: Date;
}): DraftDto {
  return {
    exerciseId: draft.exerciseId,
    source: draft.source,
    revision: draft.revision,
    contentVersionId: draft.contentVersionId,
    updatedAt: draft.updatedAt.toISOString(),
  };
}

/** Keep the newest N snapshots per draft; older ones are pruned (spec 8.3). */
async function pruneSnapshots(tx: Tx, draftId: string, keep: number): Promise<void> {
  const survivors = await tx.draftSnapshot.findMany({
    where: { draftId },
    orderBy: { createdAt: 'desc' },
    take: keep,
    select: { id: true },
  });

  await tx.draftSnapshot.deleteMany({
    where: { draftId, id: { notIn: survivors.map((s) => s.id) } },
  });
}
