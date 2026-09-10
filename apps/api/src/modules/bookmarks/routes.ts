import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireOwner } from '../../lib/auth-context.js';
import { ok, problem } from '../../lib/errors.js';
import { parseOrThrow } from '../../lib/validate.js';
import { recordActivity } from '../../lib/activity.js';
import { findItem, latestVersionOf } from '../../lib/release.js';

const itemParamsSchema = z.object({ itemId: z.string().min(1).max(80) });

/**
 * Bookmarks point at STABLE content item ids, never at versions, so an
 * editorial update keeps them attached and removing an item from a release
 * leaves them intact but marked archived (spec 8.2).
 */
export async function registerBookmarksRoutes(app: FastifyInstance): Promise<void> {
  const { db, clock } = app.deps;

  app.get('/bookmarks', async (request, reply) => {
    const owner = requireOwner(request);

    const bookmarks = await db.bookmark.findMany({
      where: { userId: owner.userId },
      orderBy: { createdAt: 'desc' },
    });

    const user = await db.user.findUnique({
      where: { id: owner.userId },
      select: { activeReleaseId: true },
    });
    const releaseId = user?.activeReleaseId ?? null;

    const items = await Promise.all(
      bookmarks.map(async (bookmark) => {
        const inRelease = releaseId ? await findItem(db, releaseId, bookmark.contentItemId) : null;
        // Archived: keep the bookmark usable and show the last known version.
        const version = inRelease ?? (await latestVersionOf(db, bookmark.contentItemId));
        return {
          contentItemId: bookmark.contentItemId,
          title: version?.title ?? 'Unavailable content',
          kind: version?.kind ?? null,
          archived: inRelease === null,
          createdAt: bookmark.createdAt.toISOString(),
        };
      }),
    );

    return ok(reply, items);
  });

  /** Idempotent by nature: adding an existing bookmark is a no-op success. */
  app.put('/bookmarks/:itemId', async (request, reply) => {
    const owner = requireOwner(request);
    const { itemId } = parseOrThrow(itemParamsSchema, request.params);

    const item = await db.contentItem.findUnique({ where: { id: itemId } });
    if (!item) throw problem.notFound('Unknown content item.');

    const existing = await db.bookmark.findUnique({
      where: { userId_contentItemId: { userId: owner.userId, contentItemId: itemId } },
    });

    if (!existing) {
      const now = clock.now();
      await db.$transaction(async (tx) => {
        await tx.bookmark.create({
          data: { userId: owner.userId, contentItemId: itemId, createdAt: now },
        });
        await recordActivity(tx, clock, {
          userId: owner.userId,
          kind: 'bookmark_added',
          contentItemId: itemId,
        });
      });
    }

    return ok(reply, { contentItemId: itemId, bookmarked: true });
  });

  app.delete('/bookmarks/:itemId', async (request, reply) => {
    const owner = requireOwner(request);
    const { itemId } = parseOrThrow(itemParamsSchema, request.params);

    await db.bookmark.deleteMany({
      where: { userId: owner.userId, contentItemId: itemId },
    });

    return ok(reply, { contentItemId: itemId, bookmarked: false });
  });
}
