import type { FastifyInstance } from 'fastify';
import type { ChapterItem, LessonItem } from '@devpractice/contracts';
import { levelForXp } from '@devpractice/contracts';
import { requireOwner } from '../../lib/auth-context.js';
import { ok } from '../../lib/errors.js';
import { db, serverNow } from '../curriculum/shared.js';
import { loadItem, requireActiveReleaseId } from '../curriculum/release.js';

/**
 * GET /today — the resume-and-orient screen (spec 4.2).
 *
 * This is a COMPOSITION endpoint, not an extra source of truth: every field is
 * derived from the same records the dedicated routes expose. It exists so the
 * Today screen renders in one request instead of a five-way client waterfall
 * that is polled every 30 seconds while visible. It is a documented addition to
 * the section 9.2 inventory (see docs/decisions).
 *
 * Everything here is owner-scoped and read-only.
 */
export function registerTodayRoutes(app: FastifyInstance): void {
  app.get('/today', async (request, reply) => {
    const owner = requireOwner(request);
    const now = serverNow();

    // Resume = the lesson most recently worked on that is not finished. A
    // skipped lesson is a decision, not unfinished work, so it never resumes.
    const inProgress = await db().lessonProgress.findFirst({
      where: { userId: owner.userId, status: 'in_progress' },
      orderBy: { updatedAt: 'desc' },
    });

    const [reviewsDue, activeMission, recentActivity, xpRows] = await Promise.all([
      db().reviewState.count({ where: { userId: owner.userId, dueAt: { lte: now } } }),
      db().missionProgress.findFirst({
        where: { userId: owner.userId, status: 'in_progress' },
        orderBy: { updatedAt: 'desc' },
      }),
      db().activityEvent.findMany({
        where: { userId: owner.userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
      }),
      db().xpAward.findMany({ where: { userId: owner.userId }, select: { amount: true } }),
    ]);

    const totalXp = xpRows.reduce((sum, row) => sum + row.amount, 0);

    // Titles come from the active release. A lesson that has left the release
    // must not break the screen, so resolution failure degrades to no resume
    // rather than a 404 on the owner's home page.
    let resume: {
      lessonId: string;
      lessonTitle: string;
      chapterTitle: string;
      status: 'in_progress';
    } | null = null;

    if (inProgress) {
      try {
        const releaseId = await requireActiveReleaseId(db(), owner);
        const lesson = await loadItem<LessonItem>(
          db(),
          releaseId,
          inProgress.lessonId,
          'lesson',
        );
        const chapter = await loadItem<ChapterItem>(
          db(),
          releaseId,
          lesson.payload.chapterId,
          'chapter',
        );
        resume = {
          lessonId: lesson.itemId,
          lessonTitle: lesson.title,
          chapterTitle: chapter.title,
          status: 'in_progress',
        };
      } catch {
        resume = null;
      }
    }

    let missionSummary: { id: string; title: string; status: string } | null = null;
    if (activeMission) {
      let title = activeMission.missionId;
      try {
        const releaseId = await requireActiveReleaseId(db(), owner);
        const mission = await loadItem(db(), releaseId, activeMission.missionId, 'mission');
        title = mission.title;
      } catch {
        /* archived mission keeps its id as the label */
      }
      missionSummary = { id: activeMission.missionId, title, status: activeMission.status };
    }

    return ok(reply, {
      resume,
      reviewsDue,
      activeMission: missionSummary,
      recentActivity: recentActivity.map((event) => ({
        id: event.id,
        kind: event.kind,
        contentItemId: event.contentItemId,
        detail: (event.detail as Record<string, unknown> | null) ?? null,
        createdAt: event.createdAt.toISOString(),
      })),
      totalXp,
      level: levelForXp(totalXp),
    });
  });
}
