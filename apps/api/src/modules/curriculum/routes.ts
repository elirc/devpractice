import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  ChapterItem,
  CurriculumChapterDto,
  CurriculumLessonSummaryDto,
  LessonItem,
  MissionItem,
  TrackItem,
} from '@devpractice/contracts';
import { requireOwner } from '../../lib/auth-context.js';
import { ok, problem } from '../../lib/errors.js';
import { db, parseParams, parseQuery } from './shared.js';
import {
  countByParent,
  listCatalog,
  loadItem,
  loadItems,
  requireActiveReleaseId,
} from './release.js';
import { lessonStatusMap, updatedPracticeForLessons } from '../lessons/progress-helpers.js';

const trackFilterSchema = z.object({ trackId: z.string().max(80).optional() });
const idParamSchema = z.object({ id: z.string().min(1).max(80) });

/**
 * Curriculum catalogue (spec 9.2).
 *
 * The catalogue is assembled from the PROJECTED release columns plus the
 * bounded set of track and chapter payloads actually rendered. Lesson payloads
 * are NOT read here — they are loaded per chapter — so the page cost does not
 * grow with a 1,000 lesson catalogue.
 */
export function registerCurriculumRoutes(app: FastifyInstance): void {
  app.get('/curriculum', async (request, reply) => {
    const owner = requireOwner(request);
    const { trackId } = parseQuery(trackFilterSchema, request);
    const releaseId = await requireActiveReleaseId(db(), owner);

    const trackRows = await listCatalog(db(), releaseId, 'track');
    const wanted = trackId ? trackRows.filter((t) => t.itemId === trackId) : trackRows;
    if (trackId && wanted.length === 0) throw problem.notFound();

    const tracks = await loadItems<TrackItem>(
      db(),
      releaseId,
      wanted.map((t) => t.itemId),
      'track',
    );
    const lessonCounts = await countByParent(db(), releaseId, 'lesson');

    const chapterIds: string[] = [];
    for (const track of tracks) chapterIds.push(...track.payload.chapterIds);
    const chapters = await loadItems<ChapterItem>(db(), releaseId, chapterIds, 'chapter');

    const [statuses, placements] = await Promise.all([
      lessonStatusMap(db(), owner.userId),
      db().chapterPlacement.findMany({
        where: { userId: owner.userId, chapterId: { in: chapterIds } },
      }),
    ]);
    const placedOut = new Set(placements.filter((p) => p.placedOut).map((p) => p.chapterId));

    const chaptersByTrack = new Map<string, CurriculumChapterDto[]>();
    for (const chapter of chapters) {
      const lessonIds = chapter.payload.lessonIds;
      const completed = lessonIds.filter((id) => statuses.get(id) === 'completed').length;
      const dto: CurriculumChapterDto = {
        id: chapter.itemId,
        title: chapter.title,
        sortOrder: chapter.sortOrder,
        objectiveIds: chapter.payload.objectiveIds,
        lessonCount: lessonCounts.get(chapter.itemId) ?? lessonIds.length,
        completedLessonCount: completed,
        placedOut: placedOut.has(chapter.itemId),
        assessmentId: chapter.payload.assessmentId,
        missionIds: chapter.payload.missionIds,
        // Lesson summaries are served by GET /chapters/:id.
        lessons: [],
      };
      const list = chaptersByTrack.get(chapter.payload.trackId) ?? [];
      list.push(dto);
      chaptersByTrack.set(chapter.payload.trackId, list);
    }

    const data = tracks.map((track) => ({
      id: track.itemId,
      title: track.title,
      description: track.payload.description,
      targetOutcomes: track.payload.targetOutcomes,
      chapters: (chaptersByTrack.get(track.itemId) ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
    }));

    return ok(reply, data, { releaseId });
  });

  app.get('/chapters/:id', async (request, reply) => {
    const owner = requireOwner(request);
    const { id } = parseParams(idParamSchema, request);
    const releaseId = await requireActiveReleaseId(db(), owner);

    const chapter = await loadItem<ChapterItem>(db(), releaseId, id, 'chapter');
    const lessons = await loadItems<LessonItem>(
      db(),
      releaseId,
      chapter.payload.lessonIds,
      'lesson',
    );

    const statuses = await lessonStatusMap(db(), owner.userId);
    const updated = await updatedPracticeForLessons(
      db(),
      owner.userId,
      releaseId,
      lessons.map((l) => l.payload),
    );

    const placement = await db().chapterPlacement.findUnique({
      where: { userId_chapterId: { userId: owner.userId, chapterId: id } },
    });

    // The chapter page needs its track's name for the breadcrumb and summaries
    // for the linked missions. Resolving them here keeps the client from
    // issuing follow-up requests just to render one header.
    const track = await loadItem<TrackItem>(db(), releaseId, chapter.payload.trackId, 'track');
    const missions = await loadItems<MissionItem>(
      db(),
      releaseId,
      chapter.payload.missionIds,
      'mission',
    );

    const lessonDtos: CurriculumLessonSummaryDto[] = lessons.map((lesson) => ({
      id: lesson.itemId,
      title: lesson.title,
      sortOrder: lesson.sortOrder,
      estimatedMinutes: lesson.payload.estimatedMinutes,
      status: statuses.get(lesson.itemId) ?? 'not_started',
      updatedPracticeAvailable: updated.get(lesson.itemId) ?? false,
    }));

    return ok(reply, {
      id: chapter.itemId,
      title: chapter.title,
      sortOrder: chapter.sortOrder,
      trackId: chapter.payload.trackId,
      trackTitle: track.title,
      bodyMarkdown: chapter.payload.bodyMarkdown,
      objectiveIds: chapter.payload.objectiveIds,
      // Suggested prerequisites are CONCEPT-level and advisory (spec 3.1).
      // They never block entry and are never chapter links.
      prerequisiteIds: chapter.payload.prerequisiteIds,
      assessmentId: chapter.payload.assessmentId,
      missionIds: chapter.payload.missionIds,
      missions: missions.map((mission) => ({
        id: mission.itemId,
        title: mission.title,
        workType: mission.payload.workType,
        stack: mission.payload.stack,
        release: mission.payload.release,
      })),
      placedOut: placement?.placedOut ?? false,
      placementAvailable: true,
      lessonCount: lessonDtos.length,
      completedLessonCount: lessonDtos.filter((l) => l.status === 'completed').length,
      lessons: lessonDtos,
    });
  });
}
