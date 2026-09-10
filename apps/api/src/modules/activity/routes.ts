import type { FastifyInstance } from 'fastify';
import { paginationQuerySchema } from '@devpractice/contracts';
import { requireOwner } from '../../lib/auth-context.js';
import { ok } from '../../lib/errors.js';
import { parseOrThrow } from '../../lib/validate.js';
import { buildPage, decodeCursor } from '../../lib/pagination.js';

/**
 * Recent activity, ordered by the SERVER clock (spec 9.4). Two devices adding
 * events concurrently converge here because ordering never depends on a client
 * timestamp.
 */
export async function registerActivityRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.deps;

  app.get('/activity', async (request, reply) => {
    const owner = requireOwner(request);
    const query = parseOrThrow(paginationQuerySchema, request.query);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = await db.activityEvent.findMany({
      where: {
        userId: owner.userId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.ts) } },
                { createdAt: new Date(cursor.ts), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    const page = buildPage(rows, query.limit, (r) => r.createdAt);
    return ok(
      reply,
      page.items.map((e) => ({
        id: e.id,
        kind: e.kind,
        contentItemId: e.contentItemId,
        relatedRecordId: e.relatedRecordId,
        detail: e.detail as Record<string, unknown> | null,
        createdAt: e.createdAt.toISOString(),
      })),
      page.meta,
    );
  });
}
