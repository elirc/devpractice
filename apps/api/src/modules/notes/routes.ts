import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { noteCreateSchema, notePatchSchema, paginationQuerySchema } from '@devpractice/contracts';
import { requireOwner } from '../../lib/auth-context.js';
import { ok, problem } from '../../lib/errors.js';
import { parseOrThrow } from '../../lib/validate.js';
import { buildPage, decodeCursor } from '../../lib/pagination.js';
import { findReceipt, storeReceipt } from '../../lib/idempotency.js';
import { recordActivity } from '../../lib/activity.js';

const idParamsSchema = z.object({ id: z.string().uuid() });
const deleteQuerySchema = z.object({ expectedRevision: z.coerce.number().int().min(0) });
const listQuerySchema = paginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  contentItemId: z.string().max(80).optional(),
});

interface NoteDto {
  id: string;
  contentItemId: string | null;
  title: string;
  body: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

function toDto(note: {
  id: string;
  contentItemId: string | null;
  title: string;
  body: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}): NoteDto {
  return {
    id: note.id,
    contentItemId: note.contentItemId,
    title: note.title,
    body: note.body,
    revision: note.revision,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

export async function registerNotesRoutes(app: FastifyInstance): Promise<void> {
  const { db, clock } = app.deps;

  app.get('/notes', async (request, reply) => {
    const owner = requireOwner(request);
    const query = parseOrThrow(listQuerySchema, request.query);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = await db.note.findMany({
      where: {
        userId: owner.userId,
        deletedAt: null,
        ...(query.contentItemId ? { contentItemId: query.contentItemId } : {}),
        ...(query.q
          ? {
              OR: [
                { title: { contains: query.q, mode: 'insensitive' as const } },
                { body: { contains: query.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
        ...(cursor
          ? {
              OR: [
                { updatedAt: { lt: new Date(cursor.ts) } },
                { updatedAt: new Date(cursor.ts), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    const page = buildPage(rows, query.limit, (r) => r.updatedAt);
    return ok(reply, page.items.map(toDto), page.meta);
  });

  app.post('/notes', async (request, reply) => {
    const owner = requireOwner(request);
    const body = parseOrThrow(noteCreateSchema, request.body);

    const created = await db.$transaction(async (tx) => {
      const replay = await findReceipt<NoteDto>(
        tx,
        owner.userId,
        body.clientEventId,
        'notes.create',
        body,
      );
      if (replay.replayed && replay.response) return replay.response;

      // A note may hang off content that is no longer in the active release,
      // so only require that the item exists at all.
      if (body.contentItemId) {
        const item = await tx.contentItem.findUnique({ where: { id: body.contentItemId } });
        if (!item) throw problem.notFound('Unknown content item.');
      }

      const now = clock.now();
      const note = await tx.note.create({
        data: {
          userId: owner.userId,
          contentItemId: body.contentItemId,
          title: body.title,
          body: body.body,
          createdAt: now,
          updatedAt: now,
        },
      });

      await recordActivity(tx, clock, {
        userId: owner.userId,
        kind: 'note_created',
        contentItemId: body.contentItemId,
        relatedRecordId: note.id,
      });

      const dto = toDto(note);
      await storeReceipt(tx, owner.userId, body.clientEventId, 'notes.create', body, dto);
      return dto;
    });

    return ok(reply.status(201), created);
  });

  app.patch('/notes/:id', async (request, reply) => {
    const owner = requireOwner(request);
    const { id } = parseOrThrow(idParamsSchema, request.params);
    const body = parseOrThrow(notePatchSchema, request.body);

    // Scoped by userId: another owner's note is simply not found.
    const updated = await db.note.updateMany({
      where: { id, userId: owner.userId, deletedAt: null, revision: body.expectedRevision },
      data: {
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.body === undefined ? {} : { body: body.body }),
        revision: { increment: 1 },
        updatedAt: clock.now(),
      },
    });

    if (updated.count === 0) {
      await throwNoteConflictOrNotFound(app, owner.userId, id);
    }

    const fresh = await db.note.findFirstOrThrow({ where: { id, userId: owner.userId } });
    return ok(reply, toDto(fresh));
  });

  /**
   * Soft delete, revision-checked. A stale client must not be able to delete a
   * note that another device has since edited (spec 9.4).
   */
  app.delete('/notes/:id', async (request, reply) => {
    const owner = requireOwner(request);
    const { id } = parseOrThrow(idParamsSchema, request.params);
    const query = parseOrThrow(deleteQuerySchema, request.query);

    const deleted = await db.note.updateMany({
      where: { id, userId: owner.userId, deletedAt: null, revision: query.expectedRevision },
      data: { deletedAt: clock.now(), revision: { increment: 1 } },
    });

    if (deleted.count === 0) {
      await throwNoteConflictOrNotFound(app, owner.userId, id);
    }
    return ok(reply, { deleted: true });
  });
}

/**
 * Distinguish "someone else changed it" from "it is not yours / gone".
 * Both paths are scoped by userId so a foreign id never leaks its existence.
 */
async function throwNoteConflictOrNotFound(
  app: FastifyInstance,
  userId: string,
  id: string,
): Promise<never> {
  const current = await app.deps.db.note.findFirst({ where: { id, userId } });
  if (!current || current.deletedAt) throw problem.notFound('Note not found.');
  throw problem.revisionConflict('This note changed on another device.', {
    server: toDto(current),
    serverRevision: current.revision,
    serverUpdatedAt: current.updatedAt.toISOString(),
  });
}
