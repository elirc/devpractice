import type { FastifyInstance } from 'fastify';
import { requireOwner } from '../../lib/auth-context.js';
import { ok } from '../../lib/errors.js';
import { totalXp } from '../../lib/xp.js';
import { levelForXp } from '@devpractice/contracts';

/**
 * Portable JSON export of the owner's learning record (spec 9.2, 15.3).
 *
 * This is a PORTABILITY feature, not a backup: it carries learning records and
 * the content references they point at, but restoring a working installation
 * still requires a consistent database backup.
 */
export const EXPORT_SCHEMA_VERSION = 1;

export async function registerExportsRoutes(app: FastifyInstance): Promise<void> {
  const { db, clock } = app.deps;

  app.get('/exports/progress', async (request, reply) => {
    const owner = requireOwner(request);

    // Deliberately sequential. This is a one-shot download for a single owner,
    // so latency is irrelevant, and a twelve-way fan-out would spike the
    // connection pool for no benefit.
    const scope = { userId: owner.userId };

    const user = await db.user.findUniqueOrThrow({
      where: { id: owner.userId },
      select: {
        displayEmail: true,
        timezone: true,
        theme: true,
        activeReleaseId: true,
        createdAt: true,
      },
    });
    const lessonProgress = await db.lessonProgress.findMany({ where: scope });
    const attempts = await db.attempt.findMany({
      where: scope,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        exerciseId: true,
        exerciseVersionId: true,
        masteryRevision: true,
        outcome: true,
        gradingOrigin: true,
        assistance: true,
        createdAt: true,
      },
    });
    const reveals = await db.revealEvent.findMany({
      where: scope,
      orderBy: { createdAt: 'asc' },
    });
    const placements = await db.placementAttempt.findMany({
      where: scope,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        chapterId: true,
        assessmentVersionId: true,
        score: true,
        qualified: true,
        practiceOnly: true,
        createdAt: true,
      },
    });
    const chapterPlacements = await db.chapterPlacement.findMany({ where: scope });
    const reviewStates = await db.reviewState.findMany({ where: scope });
    const reviewEvents = await db.reviewEvent.findMany({
      where: scope,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        cardId: true,
        rating: true,
        correctness: true,
        gradingOrigin: true,
        createdAt: true,
      },
    });
    const notes = await db.note.findMany({ where: { ...scope, deletedAt: null } });
    const bookmarks = await db.bookmark.findMany({ where: scope });
    const missions = await db.missionProgress.findMany({ where: scope });
    const xpAwards = await db.xpAward.findMany({ where: scope, orderBy: { createdAt: 'asc' } });

    const xp = await totalXp(db, owner.userId);

    reply.header(
      'content-disposition',
      `attachment; filename="devpractice-progress-${clock.now().toISOString().slice(0, 10)}.json"`,
    );

    return ok(reply, {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: clock.now().toISOString(),
      account: {
        email: user.displayEmail,
        timezone: user.timezone,
        theme: user.theme,
        memberSince: user.createdAt.toISOString(),
      },
      activeReleaseId: user.activeReleaseId,
      totals: { totalXp: xp, level: levelForXp(xp) },
      lessonProgress: lessonProgress.map((l) => ({
        lessonId: l.lessonId,
        status: l.status,
        startedAt: l.startedAt?.toISOString() ?? null,
        completedAt: l.completedAt?.toISOString() ?? null,
      })),
      attempts: attempts.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      reveals: reveals.map((r) => ({
        itemId: r.itemId,
        masteryRevision: r.masteryRevision,
        revealKind: r.revealKind,
        hintIndex: r.hintIndex,
        createdAt: r.createdAt.toISOString(),
      })),
      placementAttempts: placements.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
      chapterPlacements: chapterPlacements.map((c) => ({
        chapterId: c.chapterId,
        placedOut: c.placedOut,
        qualifiedAt: c.qualifiedAt?.toISOString() ?? null,
      })),
      reviewStates: reviewStates.map((r) => ({
        cardId: r.cardId,
        step: r.step,
        dueAt: r.dueAt.toISOString(),
        lastReviewedAt: r.lastReviewedAt?.toISOString() ?? null,
      })),
      reviewEvents: reviewEvents.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      notes: notes.map((n) => ({
        id: n.id,
        contentItemId: n.contentItemId,
        title: n.title,
        body: n.body,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
      })),
      bookmarks: bookmarks.map((b) => ({
        contentItemId: b.contentItemId,
        createdAt: b.createdAt.toISOString(),
      })),
      missionProgress: missions.map((m) => ({
        missionId: m.missionId,
        status: m.status,
        checklist: m.checklist,
        repositoryUrl: m.repositoryUrl,
        commitHash: m.commitHash,
        report: m.report,
        /** Mission outcomes were reported by the owner, not verified here. */
        verification: 'self_reported',
        updatedAt: m.updatedAt.toISOString(),
      })),
      xpAwards: xpAwards.map((x) => ({
        awardKey: x.awardKey,
        amount: x.amount,
        reason: x.reason,
        createdAt: x.createdAt.toISOString(),
      })),
    });
  });
}
