import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ContentItem, ContentPackage } from '@devpractice/contracts';
import { canonicalise, decideVersion, summariseRelease, type DiffItem } from '@devpractice/learning-core';
import { createHash } from 'node:crypto';
import { requireOwner } from '../../lib/auth-context.js';
import { ok, problem } from '../../lib/errors.js';
import { db, parseBody, parseParams, parseQuery, recordActivity, serverNow } from '../curriculum/shared.js';
import { packageChecksum, projectionFor, validatePackage } from './validate.js';

const idParamSchema = z.object({ id: z.string().uuid() });
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const publishSchema = z.object({
  /** The release the draft was previewed against; a mismatch is a conflict. */
  expectedBaseReleaseId: z.string().uuid().nullable().default(null),
  checksum: z.string().min(16).max(128),
});
const activateSchema = z.object({
  expectedActiveReleaseId: z.string().uuid().nullable().default(null),
});

/** V1 accepts a single JSON snapshot package, capped at 10 MiB. */
const MAX_PACKAGE_BYTES = 10 * 1024 * 1024;

function toDiffItems(items: ContentItem[], versions: Map<string, { version: number; masteryRevision: number }>): DiffItem[] {
  return items.map((item) => {
    const known = versions.get(item.id);
    return {
      ...(item as unknown as Record<string, unknown>),
      id: item.id,
      kind: item.kind,
      version: known?.version ?? 1,
      masteryRevision: known?.masteryRevision ?? 1,
    } satisfies DiffItem;
  });
}

export function registerImportsRoutes(app: FastifyInstance): void {
  /**
   * Validate and persist a DRAFT release. A draft never affects the learner:
   * it exists so the owner can preview added, changed and archived items before
   * choosing to publish.
   */
  app.post('/content/imports', async (request, reply) => {
    const owner = requireOwner(request);

    const raw = request.body;
    const size = Buffer.byteLength(JSON.stringify(raw ?? null), 'utf8');
    if (size > MAX_PACKAGE_BYTES) {
      throw problem.tooLarge(`Content packages are limited to ${MAX_PACKAGE_BYTES} bytes.`);
    }

    const report = validatePackage(raw);
    if (!report.valid) {
      throw problem.contentInvalid('This package did not pass validation.', {
        errors: report.errors.map((e) => `${e.path}: ${e.message}`),
      });
    }
    const pkg = raw as ContentPackage;

    const user = await db().user.findUniqueOrThrow({
      where: { id: owner.userId },
      select: { activeReleaseId: true },
    });

    // Diff against what is live today so the preview is meaningful.
    const currentItems = user.activeReleaseId
      ? await db().releaseItem.findMany({
          where: { releaseId: user.activeReleaseId },
          include: { version: true },
        })
      : [];
    const previousDiff: DiffItem[] = currentItems.map((ri) => ({
      ...(ri.version.payload as unknown as Record<string, unknown>),
      id: ri.itemId,
      kind: ri.kind,
      version: ri.version.version,
      masteryRevision: ri.version.masteryRevision,
    }));
    const knownVersions = new Map(
      currentItems.map((ri) => [
        ri.itemId,
        { version: ri.version.version, masteryRevision: ri.version.masteryRevision },
      ]),
    );
    const changeSummary = summariseRelease(previousDiff, toDiffItems(pkg.items, knownVersions));

    const existing = await db().contentRelease.findUnique({
      where: {
        ownerId_packageId_packageVersion: {
          ownerId: owner.userId,
          packageId: pkg.packageId,
          packageVersion: pkg.packageVersion,
        },
      },
    });
    if (existing) {
      // A matching checksum is a replay; different bytes at the same version
      // would silently rewrite history, so it is refused.
      if (existing.checksum === report.checksum) {
        return ok(reply, {
          importId: existing.id,
          replayed: true,
          state: existing.state,
          checksum: existing.checksum,
          validation: existing.validationSummary,
          changeSummary: existing.changeSummary,
        });
      }
      throw problem.releaseConflict(
        `Package ${pkg.packageId} version ${pkg.packageVersion} already exists with different content. Publish a new packageVersion instead.`,
        { existingReleaseId: existing.id },
      );
    }

    const draft = await db().contentRelease.create({
      data: {
        packageId: pkg.packageId,
        packageVersion: pkg.packageVersion,
        ownerId: owner.userId,
        checksum: report.checksum,
        state: 'draft',
        title: pkg.title,
        baseReleaseId: user.activeReleaseId,
        // A draft creates NO ContentVersion or ReleaseItem rows: its items are
        // parked here until publication, so a half-written release can never
        // be reachable by the learner. (ContentRelease has no dedicated draft
        // payload column and the schema is frozen.)
        validationSummary: {
          counts: report.counts,
          warnings: report.warnings,
          errors: [],
          package: pkg,
        } as object,
        changeSummary: changeSummary as unknown as object,
      },
    });

    await recordActivity(db(), owner.userId, 'content.import.drafted', null, draft.id, {
      packageId: pkg.packageId,
      packageVersion: pkg.packageVersion,
    });

    return reply.status(201).send({
      data: {
        importId: draft.id,
        replayed: false,
        state: draft.state,
        checksum: report.checksum,
        baseReleaseId: user.activeReleaseId,
        counts: report.counts,
        warnings: report.warnings,
        changeSummary,
        notice:
          'This package is a complete snapshot release. Publishing replaces the active release with exactly these items.',
      },
    });
  });

  app.get('/content/imports/:id', async (request, reply) => {
    const owner = requireOwner(request);
    const { id } = parseParams(idParamSchema, request);
    const draft = await db().contentRelease.findUnique({ where: { id } });
    if (!draft || draft.ownerId !== owner.userId) throw problem.notFound();

    const summary = draft.validationSummary as Record<string, unknown>;
    return ok(reply, {
      importId: draft.id,
      state: draft.state,
      packageId: draft.packageId,
      packageVersion: draft.packageVersion,
      title: draft.title,
      checksum: draft.checksum,
      baseReleaseId: draft.baseReleaseId,
      counts: summary.counts ?? {},
      warnings: summary.warnings ?? [],
      changeSummary: draft.changeSummary,
      createdAt: draft.createdAt.toISOString(),
      publishedAt: draft.publishedAt?.toISOString() ?? null,
    });
  });

  /**
   * Publish atomically (spec 10.4). Every ContentItem, ContentVersion and
   * ReleaseItem row plus the active-release pointer move in ONE transaction.
   * A competing publication returns 409 rather than silently winning.
   */
  app.post('/content/imports/:id/publish', async (request, reply) => {
    const owner = requireOwner(request);
    const { id } = parseParams(idParamSchema, request);
    const body = parseBody(publishSchema, request);

    const result = await db().$transaction(
      async (tx) => {
      const draft = await tx.contentRelease.findUnique({ where: { id } });
      if (!draft || draft.ownerId !== owner.userId) throw problem.notFound();
      if (draft.state === 'published') {
        throw problem.releaseConflict('That release is already published.', { releaseId: draft.id });
      }
      if (draft.checksum !== body.checksum) {
        throw problem.releaseConflict('The package changed since it was previewed.', {
          expected: draft.checksum,
        });
      }

      const user = await tx.user.findUniqueOrThrow({
        where: { id: owner.userId },
        select: { activeReleaseId: true, activeReleaseRevision: true },
      });
      if ((user.activeReleaseId ?? null) !== (body.expectedBaseReleaseId ?? null)) {
        throw problem.releaseConflict(
          'Another release was published while this draft was open. Re-import against the current release.',
          { currentActiveReleaseId: user.activeReleaseId },
        );
      }

      const summary = draft.validationSummary as { package?: ContentPackage };
      const pkg = summary.package;
      if (!pkg) throw problem.contentInvalid('This draft no longer carries its package payload.');

      // Re-validate at publish time: the draft must still be sound.
      const revalidated = validatePackage(pkg);
      if (!revalidated.valid || revalidated.checksum !== draft.checksum) {
        throw problem.contentInvalid('This draft failed re-validation at publish time.', {
          errors: revalidated.errors.map((e) => `${e.path}: ${e.message}`),
        });
      }

      const previousItems = user.activeReleaseId
        ? await tx.releaseItem.findMany({
            where: { releaseId: user.activeReleaseId },
            include: { version: true },
          })
        : [];
      const previousById = new Map(previousItems.map((ri) => [ri.itemId, ri]));

      /**
       * Decide every row up front, then write in BATCHES.
       *
       * A per-item upsert loop costs three round trips per item. A real V1
       * release is well over two hundred items, which overran Prisma's
       * interactive transaction budget and made publication fail outright.
       * Batching keeps the whole publication inside ONE transaction — the
       * atomicity spec 10.4 requires — while turning 3N queries into a
       * handful.
       */
      const planned = pkg.items.map((item) => {
        const projection = projectionFor(item);
        const previous = previousById.get(item.id);
        const previousDiff: DiffItem | null = previous
          ? {
              ...(previous.version.payload as unknown as Record<string, unknown>),
              id: previous.itemId,
              kind: previous.kind,
              version: previous.version.version,
              masteryRevision: previous.version.masteryRevision,
            }
          : null;
        const nextDiff: DiffItem = {
          ...(item as unknown as Record<string, unknown>),
          id: item.id,
          kind: item.kind,
          version: previous?.version.version ?? 1,
          masteryRevision: previous?.version.masteryRevision ?? 1,
        };
        return { item, projection, decision: decideVersion(previousDiff, nextDiff) };
      });

      const itemIds = planned.map((p) => p.item.id);
      const versionKey = (itemId: string, version: number): string => `${itemId}@${version}`;

      await tx.contentItem.createMany({
        data: planned.map((p) => ({ id: p.item.id, kind: p.item.kind })),
        skipDuplicates: true,
      });

      const knownRows = await tx.contentVersion.findMany({
        where: { itemId: { in: itemIds } },
        select: { id: true, itemId: true, version: true },
      });
      const versionIdByKey = new Map(
        knownRows.map((row) => [versionKey(row.itemId, row.version), row.id]),
      );

      // Never recycle a version number with different bytes: a row is reused
      // only when the decision resolved to a version that already exists.
      const missing = planned.filter(
        (p) => !versionIdByKey.has(versionKey(p.item.id, p.decision.version)),
      );
      if (missing.length > 0) {
        await tx.contentVersion.createMany({
          data: missing.map((p) => ({
            itemId: p.item.id,
            version: p.decision.version,
            masteryRevision: p.decision.masteryRevision,
            kind: p.item.kind,
            parentId: p.projection.parentId,
            sortOrder: p.projection.sortOrder,
            primaryConceptId: p.projection.primaryConceptId,
            title: p.item.title,
            payload: p.item as unknown as object,
            checksum: createHash('sha256').update(canonicalise(p.item)).digest('hex'),
          })),
        });
        const created = await tx.contentVersion.findMany({
          where: { OR: missing.map((p) => ({ itemId: p.item.id, version: p.decision.version })) },
          select: { id: true, itemId: true, version: true },
        });
        for (const row of created) {
          versionIdByKey.set(versionKey(row.itemId, row.version), row.id);
        }
      }

      await tx.releaseItem.createMany({
        data: planned.map((p) => {
          const versionId = versionIdByKey.get(versionKey(p.item.id, p.decision.version));
          if (!versionId) {
            // Refuse to write a partial release rather than skip an item.
            throw problem.contentInvalid(
              `Could not resolve a content version for "${p.item.id}"; publication aborted.`,
            );
          }
          return {
            releaseId: draft.id,
            itemId: p.item.id,
            versionId,
            kind: p.item.kind,
            parentId: p.projection.parentId,
            sortOrder: p.projection.sortOrder,
          };
        }),
      });

      const now = serverNow();
      await tx.contentRelease.update({
        where: { id: draft.id },
        data: { state: 'published', publishedAt: now },
      });
      if (user.activeReleaseId) {
        await tx.contentRelease.update({
          where: { id: user.activeReleaseId },
          data: { state: 'superseded' },
        });
      }
      // The pointer moves inside the same transaction as the rows.
      await tx.user.update({
        where: { id: owner.userId },
        data: {
          activeReleaseId: draft.id,
          activeReleaseRevision: { increment: 1 },
        },
      });

      await recordActivity(tx, owner.userId, 'content.release.published', null, draft.id, {
        packageId: draft.packageId,
        packageVersion: draft.packageVersion,
      });

      return {
        releaseId: draft.id,
        publishedAt: now.toISOString(),
        itemCount: pkg.items.length,
        previousReleaseId: user.activeReleaseId,
        changeSummary: draft.changeSummary,
        notice:
          'Archived items keep their history: existing notes, bookmarks and attempts still resolve to the version they used.',
      };
      },
      {
        // Publishing a full release writes a few hundred rows. Prisma's 5s
        // default is not a budget a real release fits into, and splitting the
        // work would break the atomicity guarantee, so the budget is raised
        // deliberately instead.
        timeout: 60_000,
        maxWait: 15_000,
      },
    );

    return ok(reply, result);
  });

  app.get('/content/releases', async (request, reply) => {
    const owner = requireOwner(request);
    const { limit } = parseQuery(listQuerySchema, request);
    const [releases, user] = await Promise.all([
      db().contentRelease.findMany({
        where: { ownerId: owner.userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          packageId: true,
          packageVersion: true,
          title: true,
          state: true,
          checksum: true,
          createdAt: true,
          publishedAt: true,
          _count: { select: { items: true } },
        },
      }),
      db().user.findUniqueOrThrow({
        where: { id: owner.userId },
        select: { activeReleaseId: true },
      }),
    ]);

    return ok(
      reply,
      releases.map((r) => ({
        id: r.id,
        packageId: r.packageId,
        packageVersion: r.packageVersion,
        title: r.title,
        state: r.state,
        checksum: r.checksum,
        itemCount: r._count.items,
        active: r.id === user.activeReleaseId,
        createdAt: r.createdAt.toISOString(),
        publishedAt: r.publishedAt?.toISOString() ?? null,
      })),
      { activeReleaseId: user.activeReleaseId },
    );
  });

  /**
   * Restore an earlier published release. This is an explicit action and it
   * deletes NOTHING: attempts made against newer versions survive, and the
   * newer content simply stops being active.
   */
  app.post('/content/releases/:id/activate', async (request, reply) => {
    const owner = requireOwner(request);
    const { id } = parseParams(idParamSchema, request);
    const body = parseBody(activateSchema, request);

    const result = await db().$transaction(async (tx) => {
      const release = await tx.contentRelease.findUnique({ where: { id } });
      if (!release || release.ownerId !== owner.userId) throw problem.notFound();
      if (release.state === 'draft') {
        throw problem.releaseConflict('Publish this draft before activating it.');
      }

      const user = await tx.user.findUniqueOrThrow({
        where: { id: owner.userId },
        select: { activeReleaseId: true },
      });
      if ((user.activeReleaseId ?? null) !== (body.expectedActiveReleaseId ?? null)) {
        throw problem.revisionConflict('The active release changed on another device.', {
          serverActiveReleaseId: user.activeReleaseId,
        });
      }

      await tx.contentRelease.update({ where: { id }, data: { state: 'published' } });
      if (user.activeReleaseId && user.activeReleaseId !== id) {
        await tx.contentRelease.update({
          where: { id: user.activeReleaseId },
          data: { state: 'superseded' },
        });
      }
      await tx.user.update({
        where: { id: owner.userId },
        data: { activeReleaseId: id, activeReleaseRevision: { increment: 1 } },
      });
      await recordActivity(tx, owner.userId, 'content.release.activated', null, id);

      return {
        activeReleaseId: id,
        previousReleaseId: user.activeReleaseId,
        notice:
          'Attempts recorded against newer versions are retained. New content does not inherit old mastery.',
      };
    });

    return ok(reply, result);
  });
}
