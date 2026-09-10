import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  missionItemSchema,
  missionProgressSchema,
  revealBodySchema,
  type MissionItem,
} from '@devpractice/contracts';
import { Prisma, type ContentVersion } from '@prisma/client';
import { requireOwner } from '../../lib/auth-context.js';
import { ok, problem } from '../../lib/errors.js';
import { parseOrThrow } from '../../lib/validate.js';
import { findReceipt, storeReceipt } from '../../lib/idempotency.js';
import { recordActivity } from '../../lib/activity.js';
import { listByKind, requireActiveReleaseId, resolveItem } from '../../lib/release.js';
import { XP, awardKeys, awardXp } from '../../lib/xp.js';

const missionParamsSchema = z.object({ id: z.string().min(1).max(80) });
const missionQuerySchema = z.object({
  release: z.enum(['v1', 'v2', 'v3']).optional(),
  stack: z.enum(['react', 'node', 'fullstack', 'dotnet']).optional(),
  projectId: z.string().max(80).optional(),
  workType: z.enum(['build', 'extend', 'repair', 'refactor', 'investigate']).optional(),
});

/** Authored payloads are validated at import; re-parse defensively on read. */
function missionOf(version: ContentVersion): MissionItem {
  const parsed = missionItemSchema.safeParse(version.payload);
  if (!parsed.success) {
    throw problem.contentInvalid('Stored mission content is not readable.');
  }
  return parsed.data;
}

export async function registerMissionsRoutes(app: FastifyInstance): Promise<void> {
  const { db, clock } = app.deps;

  app.get('/missions', async (request, reply) => {
    const owner = requireOwner(request);
    const filters = parseOrThrow(missionQuerySchema, request.query);
    const releaseId = await requireActiveReleaseId(db, owner);

    const versions = await listByKind(db, releaseId, 'mission');
    const progressRows = await db.missionProgress.findMany({ where: { userId: owner.userId } });
    const progressByMission = new Map(progressRows.map((p) => [p.missionId, p]));

    const missions = versions
      .map(missionOf)
      .filter((m) => !filters.release || m.release === filters.release)
      .filter((m) => !filters.stack || m.stack === filters.stack)
      .filter((m) => !filters.projectId || m.projectId === filters.projectId)
      .filter((m) => !filters.workType || m.workType === filters.workType)
      .map((mission) => {
        const progress = progressByMission.get(mission.id);
        return {
          id: mission.id,
          title: mission.title,
          projectId: mission.projectId,
          workType: mission.workType,
          stack: mission.stack,
          release: mission.release,
          chapterPrerequisiteIds: mission.chapterPrerequisiteIds,
          status: progress?.status ?? 'not_started',
          updatedAt: progress?.updatedAt.toISOString() ?? null,
        };
      });

    return ok(reply, missions);
  });

  /**
   * The mission brief. Hints and the reference solution are deliberately
   * excluded — they arrive only through an explicit reveal, which is recorded.
   */
  app.get('/missions/:id', async (request, reply) => {
    const owner = requireOwner(request);
    const { id } = parseOrThrow(missionParamsSchema, request.params);
    const releaseId = await requireActiveReleaseId(db, owner);

    const version = await resolveItem(db, releaseId, id, 'mission');
    const mission = missionOf(version);

    const progress = await db.missionProgress.findUnique({
      where: { userId_missionId: { userId: owner.userId, missionId: id } },
    });

    const reveals = await db.revealEvent.findMany({
      where: { userId: owner.userId, itemId: id, masteryRevision: version.masteryRevision },
      select: { revealKind: true, hintIndex: true },
    });

    return ok(reply, {
      id: mission.id,
      versionId: version.id,
      masteryRevision: version.masteryRevision,
      title: mission.title,
      bodyMarkdown: mission.bodyMarkdown,
      projectId: mission.projectId,
      workType: mission.workType,
      stack: mission.stack,
      release: mission.release,
      chapterPrerequisiteIds: mission.chapterPrerequisiteIds,
      starterAssetId: mission.starterAssetId,
      starterCommit: mission.starterCommit,
      setupMarkdown: mission.setupMarkdown,
      baselineChecks: mission.baselineChecks,
      acceptanceCriteria: mission.acceptanceCriteria,
      verificationCommands: mission.verificationCommands,
      checklist: mission.checklist,
      reflectionRubric: mission.reflectionRubric,
      hintsAvailable: mission.hints.length,
      revealedHintIndexes: reveals
        .filter((r) => r.revealKind === 'hint' && r.hintIndex !== null)
        .map((r) => r.hintIndex as number),
      solutionRevealed: reveals.some((r) => r.revealKind === 'solution'),
      progress: progress
        ? {
            status: progress.status,
            checklist: progress.checklist as Record<string, boolean>,
            repositoryUrl: progress.repositoryUrl,
            commitHash: progress.commitHash,
            report: progress.report as Record<string, unknown> | null,
            revision: progress.revision,
            updatedAt: progress.updatedAt.toISOString(),
          }
        : { status: 'not_started', checklist: {}, repositoryUrl: null, commitHash: null, report: null, revision: 0, updatedAt: null },
      /** The platform never runs or clones mission work. */
      verification: 'self_reported',
    });
  });

  app.post('/missions/:id/reveals', async (request, reply) => {
    const owner = requireOwner(request);
    const { id } = parseOrThrow(missionParamsSchema, request.params);
    const body = parseOrThrow(revealBodySchema, request.body);
    const releaseId = await requireActiveReleaseId(db, owner);

    const version = await resolveItem(db, releaseId, id, 'mission');
    const mission = missionOf(version);

    if (body.revealKind === 'hint' && body.hintIndex === undefined) {
      throw problem.badRequest('A hint reveal must name which hint.');
    }

    const content = await db.$transaction(async (tx) => {
      const replay = await findReceipt<{ content: string }>(
        tx,
        owner.userId,
        body.clientEventId,
        'missions.reveal',
        { missionId: id, ...body },
      );
      if (replay.replayed && replay.response) return replay.response;

      await tx.revealEvent.create({
        data: {
          userId: owner.userId,
          itemId: id,
          masteryRevision: version.masteryRevision,
          revealKind: body.revealKind,
          hintIndex: body.hintIndex ?? null,
          clientEventId: body.clientEventId,
          createdAt: clock.now(),
        },
      });

      await recordActivity(tx, clock, {
        userId: owner.userId,
        kind: body.revealKind === 'hint' ? 'hint_revealed' : 'solution_revealed',
        contentItemId: id,
        detail: { hintIndex: body.hintIndex ?? null, surface: 'mission' },
      });

      const text =
        body.revealKind === 'solution'
          ? mission.solutionMarkdown
          : (mission.hints[body.hintIndex as 0 | 1 | 2] ?? '');

      const response = { content: text };
      await storeReceipt(
        tx,
        owner.userId,
        body.clientEventId,
        'missions.reveal',
        { missionId: id, ...body },
        response,
      );
      return response;
    });

    return ok(reply, content);
  });

  /**
   * Checklist and self-reported completion. Revision-checked like notes.
   * The repository URL is validated and stored as a LINK only: the server
   * never fetches it, clones it, or runs anything from it (spec 4.4).
   */
  app.put('/missions/:id/progress', async (request, reply) => {
    const owner = requireOwner(request);
    const { id } = parseOrThrow(missionParamsSchema, request.params);
    const body = parseOrThrow(missionProgressSchema, request.body);
    const releaseId = await requireActiveReleaseId(db, owner);

    const version = await resolveItem(db, releaseId, id, 'mission');
    const mission = missionOf(version);

    const allowedKeys = new Set(mission.checklist.map((c) => c.id));
    for (const key of Object.keys(body.checklist)) {
      if (!allowedKeys.has(key)) {
        throw problem.badRequest(`Unknown checklist item: ${key}`);
      }
    }

    const saved = await db.$transaction(async (tx) => {
      const existing = await tx.missionProgress.findUnique({
        where: { userId_missionId: { userId: owner.userId, missionId: id } },
      });

      const report =
        body.report === null
          ? null
          : {
              ...body.report,
              // Stored evidence is explicitly labelled: nothing here was verified.
              verification: 'self_reported' as const,
              reportedAt: clock.now().toISOString(),
            };

      if (!existing) {
        if (body.expectedRevision !== 0) {
          throw problem.revisionConflict('This mission has no saved progress on the server.', {
            server: null,
            serverRevision: 0,
            serverUpdatedAt: clock.now().toISOString(),
          });
        }
        const now = clock.now();
        const created = await tx.missionProgress.create({
          data: {
            userId: owner.userId,
            missionId: id,
            checklist: body.checklist,
            status: body.status,
            repositoryUrl: body.repositoryUrl,
            commitHash: body.commitHash,
            report: report === null ? Prisma.DbNull : report,
            revision: 1,
            createdAt: now,
            updatedAt: now,
          },
        });
        await recordActivity(tx, clock, {
          userId: owner.userId,
          kind: body.status === 'completed' ? 'mission_completed' : 'mission_started',
          contentItemId: id,
        });
        if (body.status === 'completed') {
          await awardXp(
            tx,
            clock,
            owner.userId,
            awardKeys.missionCompletion(id),
            XP.missionFirstCompletion,
            `First completion of mission ${id}`,
          );
        }
        return created;
      }

      if (existing.revision !== body.expectedRevision) {
        throw problem.revisionConflict('This mission was updated on another device.', {
          server: {
            status: existing.status,
            checklist: existing.checklist as Record<string, boolean>,
            repositoryUrl: existing.repositoryUrl,
            commitHash: existing.commitHash,
            report: existing.report as Record<string, unknown> | null,
          },
          serverRevision: existing.revision,
          serverUpdatedAt: existing.updatedAt.toISOString(),
        });
      }

      const updated = await tx.missionProgress.update({
        where: { userId_missionId: { userId: owner.userId, missionId: id } },
        data: {
          checklist: body.checklist,
          status: body.status,
          repositoryUrl: body.repositoryUrl,
          commitHash: body.commitHash,
          report: report === null ? Prisma.DbNull : report,
          revision: { increment: 1 },
          updatedAt: clock.now(),
        },
      });

      if (existing.status !== 'completed' && body.status === 'completed') {
        await recordActivity(tx, clock, {
          userId: owner.userId,
          kind: 'mission_completed',
          contentItemId: id,
        });
        await awardXp(
          tx,
          clock,
          owner.userId,
          awardKeys.missionCompletion(id),
          XP.missionFirstCompletion,
          `First completion of mission ${id}`,
        );
      }

      return updated;
    });

    return ok(reply, {
      status: saved.status,
      checklist: saved.checklist as Record<string, boolean>,
      repositoryUrl: saved.repositoryUrl,
      commitHash: saved.commitHash,
      report: saved.report as Record<string, unknown> | null,
      revision: saved.revision,
      updatedAt: saved.updatedAt.toISOString(),
      verification: 'self_reported',
    });
  });
}
