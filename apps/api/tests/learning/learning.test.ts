import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { Client, buildTestApp, createOwner, uuid } from '../helpers/app.js';
import { createTestClient, resetDatabase } from '../helpers/db.js';
import {
  ASSESSMENT_ID,
  CHAPTER_ID,
  CHOICE_EXERCISE_ID,
  FN_EXERCISE_ID,
  LESSON_ID,
  RUBRIC_EXERCISE_ID,
  passingRunnerReport,
  publishRelease,
} from './fixtures.js';

let db: PrismaClient;
let app: FastifyInstance;
let client: Client;
let ownerId: string;
let versions: Map<string, string>;

/**
 * Migrations are applied OUT OF BAND before this suite runs:
 *   DATABASE_URL=$TEST_DATABASE_URL pnpm --filter @devpractice/api exec  *     prisma migrate deploy --schema ../../prisma/schema.prisma
 *
 * The shared ensureMigrated() helper shells out through `npx prisma`, which
 * hangs indefinitely on this machine, so it is deliberately not called here.
 */
beforeAll(async () => {
  db = createTestClient();
});

afterAll(async () => {
  await app?.close();
  await db?.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(db);
  if (app) await app.close();
  ({ app } = await buildTestApp(db));
  const owner = await createOwner(db, 'owner@example.com');
  ownerId = owner.id;
  ({ versionIdByItemId: versions } = await publishRelease(db, ownerId));
  client = new Client(app);
  const login = await client.login(owner.email, owner.password);
  expect(login.statusCode).toBe(200);
});

const api = (path: string) => `/api/v1${path}`;

async function submitFunctionAttempt(eventId = uuid()) {
  return client.request('POST', api('/attempts'), {
    clientEventId: eventId,
    exerciseId: FN_EXERCISE_ID,
    exerciseVersionId: versions.get(FN_EXERCISE_ID),
    source: 'function countOpen(t){return t.filter(x=>x.status==="open").length;}',
    gradingOrigin: 'browser_automated',
    runnerResult: passingRunnerReport(),
  });
}

describe('exercise payloads withhold answers', () => {
  it('omits solutions and unrevealed hints, and strips correct flags from options', async () => {
    const response = await client.request('GET', api(`/exercises/${CHOICE_EXERCISE_ID}`));
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { exercise: Record<string, unknown> } };
    const exercise = body.data.exercise;

    expect(exercise.solution).toBeNull();
    expect(exercise.revealedHints).toEqual([]);
    expect(exercise.hintCount).toBe(3);

    const serialised = JSON.stringify(exercise);
    expect(serialised).not.toContain('"correct"');
    expect(serialised).not.toContain('splice mutates');
    // The prompt itself is of course present.
    expect(serialised).toContain('without changing the input');
  });

  it('delivers function test cases, which are inspectable by design', async () => {
    const response = await client.request('GET', api(`/exercises/${FN_EXERCISE_ID}`));
    const grading = (response.json() as { data: { exercise: { grading: { cases: unknown[] } } } }).data
      .exercise.grading;
    expect(grading.cases).toHaveLength(3);
  });
});

describe('attempts', () => {
  it('grades a choice answer on the server and returns per-option explanations', async () => {
    const response = await client.request('POST', api('/attempts'), {
      clientEventId: uuid(),
      exerciseId: CHOICE_EXERCISE_ID,
      exerciseVersionId: versions.get(CHOICE_EXERCISE_ID),
      answer: ['filter'],
      gradingOrigin: 'server_objective',
    });
    expect(response.statusCode).toBe(200);
    const data = (response.json() as { data: Record<string, unknown> }).data;
    expect(data.outcome).toBe('passed');
    expect(data.gradingOrigin).toBe('server_objective');
    expect(data.xpAwarded).toBe(10);
  });

  it('rejects a client that claims the wrong grading origin', async () => {
    const response = await client.request('POST', api('/attempts'), {
      clientEventId: uuid(),
      exerciseId: CHOICE_EXERCISE_ID,
      exerciseVersionId: versions.get(CHOICE_EXERCISE_ID),
      answer: ['filter'],
      // A choice exercise is server-graded; claiming a browser run is refused.
      gradingOrigin: 'browser_automated',
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a version id that belongs to a different exercise', async () => {
    const response = await client.request('POST', api('/attempts'), {
      clientEventId: uuid(),
      exerciseId: FN_EXERCISE_ID,
      exerciseVersionId: versions.get(CHOICE_EXERCISE_ID),
      gradingOrigin: 'browser_automated',
      runnerResult: passingRunnerReport(),
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a browser report that does not account for every pinned case', async () => {
    const response = await client.request('POST', api('/attempts'), {
      clientEventId: uuid(),
      exerciseId: FN_EXERCISE_ID,
      exerciseVersionId: versions.get(FN_EXERCISE_ID),
      gradingOrigin: 'browser_automated',
      runnerResult: { status: 'passed', passedCaseIds: ['empty'], failedCaseIds: [], durationMs: 2 },
    });
    const data = (response.json() as { data: Record<string, unknown> }).data;
    expect(data.outcome).toBe('failed');
    expect(data.xpAwarded).toBe(0);
  });

  it('A03: the same clientEventId twice creates one attempt and one XP award', async () => {
    const eventId = uuid();
    const first = await submitFunctionAttempt(eventId);
    const second = await submitFunctionAttempt(eventId);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const firstData = (first.json() as { data: { attemptId: string; xpAwarded: number } }).data;
    const secondData = (second.json() as { data: { attemptId: string; xpAwarded: number } }).data;
    expect(secondData.attemptId).toBe(firstData.attemptId);
    expect(firstData.xpAwarded).toBe(10);
    // The replay reports the ORIGINAL result rather than paying again.
    expect(secondData.xpAwarded).toBe(10);

    expect(await db.attempt.count({ where: { userId: ownerId } })).toBe(1);
    expect(await db.xpAward.count({ where: { userId: ownerId } })).toBe(1);
  });

  it('A03: a retry with a different body under the same event id is a conflict', async () => {
    const eventId = uuid();
    await submitFunctionAttempt(eventId);
    const conflicting = await client.request('POST', api('/attempts'), {
      clientEventId: eventId,
      exerciseId: CHOICE_EXERCISE_ID,
      exerciseVersionId: versions.get(CHOICE_EXERCISE_ID),
      answer: ['filter'],
      gradingOrigin: 'server_objective',
    });
    expect(conflicting.statusCode).toBe(409);
    expect((conflicting.json() as { error: { code: string } }).error.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
  });

  it('awards a second exercise pass only once even across many retries', async () => {
    await submitFunctionAttempt();
    await submitFunctionAttempt();
    await submitFunctionAttempt();
    expect(await db.attempt.count({ where: { userId: ownerId } })).toBe(3);
    expect(await db.xpAward.count({ where: { userId: ownerId } })).toBe(1);
  });
});

describe('A06 assistance integrity', () => {
  it('keeps a pass solution-assisted after the solution was revealed and the editor reset', async () => {
    const reveal = await client.request('POST', api(`/exercises/${FN_EXERCISE_ID}/reveals`), {
      clientEventId: uuid(),
      revealKind: 'solution',
    });
    expect(reveal.statusCode).toBe(200);

    // "Reset starter" then solve it independently — the history still stands.
    const attempt = await submitFunctionAttempt();
    const data = (attempt.json() as { data: { assistance: string; outcome: string } }).data;
    expect(data.outcome).toBe('passed');
    expect(data.assistance).toBe('solution_viewed');

    const stored = await db.attempt.findFirstOrThrow({ where: { userId: ownerId } });
    expect(stored.assistance).toBe('solution_viewed');

    const progress = await client.request('GET', api('/progress'));
    const summary = (progress.json() as { data: { concepts: { status: string }[]; assistance: { solutionRevealCount: number } } }).data;
    expect(summary.assistance.solutionRevealCount).toBe(1);
    // One assisted pass is not mastery evidence.
    expect(summary.concepts.every((c) => c.status !== 'demonstrated')).toBe(true);
  });

  it('records hint reveals without escalating to solution assistance', async () => {
    await client.request('POST', api(`/exercises/${FN_EXERCISE_ID}/reveals`), {
      clientEventId: uuid(),
      revealKind: 'hint',
      hintIndex: 0,
    });
    const attempt = await submitFunctionAttempt();
    expect((attempt.json() as { data: { assistance: string } }).data.assistance).toBe('hints');
  });

  it('is idempotent: replaying a reveal does not record a second one', async () => {
    const eventId = uuid();
    await client.request('POST', api(`/exercises/${FN_EXERCISE_ID}/reveals`), {
      clientEventId: eventId,
      revealKind: 'hint',
      hintIndex: 1,
    });
    await client.request('POST', api(`/exercises/${FN_EXERCISE_ID}/reveals`), {
      clientEventId: eventId,
      revealKind: 'hint',
      hintIndex: 1,
    });
    expect(await db.revealEvent.count({ where: { userId: ownerId } })).toBe(1);
  });
});

describe('lesson completion', () => {
  async function satisfyAllRequired() {
    await submitFunctionAttempt();
    await client.request('POST', api('/attempts'), {
      clientEventId: uuid(),
      exerciseId: CHOICE_EXERCISE_ID,
      exerciseVersionId: versions.get(CHOICE_EXERCISE_ID),
      answer: ['filter'],
      gradingOrigin: 'server_objective',
    });
    await client.request('POST', api('/attempts'), {
      clientEventId: uuid(),
      exerciseId: RUBRIC_EXERCISE_ID,
      exerciseVersionId: versions.get(RUBRIC_EXERCISE_ID),
      answer: 'A new array of shared references.',
      gradingOrigin: 'self_reported',
      selfAssessment: 'met',
    });
  }

  it('refuses completion while required practice is outstanding', async () => {
    const response = await client.request('POST', api(`/lessons/${LESSON_ID}/complete`), {
      clientEventId: uuid(),
      acknowledgedReading: true,
    });
    expect(response.statusCode).toBe(400);
  });

  it('completes once every required objective is satisfied and awards 20 XP once', async () => {
    await satisfyAllRequired();
    const first = await client.request('POST', api(`/lessons/${LESSON_ID}/complete`), {
      clientEventId: uuid(),
      acknowledgedReading: true,
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { data: { xpAwarded: number } }).data.xpAwarded).toBe(20);

    const second = await client.request('POST', api(`/lessons/${LESSON_ID}/complete`), {
      clientEventId: uuid(),
      acknowledgedReading: true,
    });
    expect((second.json() as { data: { xpAwarded: number } }).data.xpAwarded).toBe(0);
    expect(
      await db.xpAward.count({ where: { userId: ownerId, awardKey: `lesson:${LESSON_ID}` } }),
    ).toBe(1);
  });

  it('keeps completion monotonic: skipping a completed lesson leaves it completed', async () => {
    await satisfyAllRequired();
    await client.request('POST', api(`/lessons/${LESSON_ID}/complete`), {
      clientEventId: uuid(),
      acknowledgedReading: true,
    });
    const skip = await client.request('POST', api(`/lessons/${LESSON_ID}/skip`), {
      clientEventId: uuid(),
    });
    expect((skip.json() as { data: { status: string } }).data.status).toBe('completed');
  });

  it('skipping never awards XP and preserves prior evidence', async () => {
    await submitFunctionAttempt();
    const skip = await client.request('POST', api(`/lessons/${LESSON_ID}/skip`), {
      clientEventId: uuid(),
    });
    expect((skip.json() as { data: { status: string; xpAwarded: number } }).data.status).toBe('skipped');
    expect((skip.json() as { data: { xpAwarded: number } }).data.xpAwarded).toBe(0);
    expect(await db.attempt.count({ where: { userId: ownerId } })).toBe(1);
  });

  it('enrols review cards without changing lesson status', async () => {
    const eventId = uuid();
    const first = await client.request('POST', api(`/lessons/${LESSON_ID}/review-cards`), {
      clientEventId: eventId,
    });
    expect(first.statusCode).toBe(200);
    expect(await db.reviewState.count({ where: { userId: ownerId } })).toBe(2);

    // Replay enrols nothing further.
    await client.request('POST', api(`/lessons/${LESSON_ID}/review-cards`), { clientEventId: eventId });
    expect(await db.reviewState.count({ where: { userId: ownerId } })).toBe(2);

    const progress = await db.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: ownerId, lessonId: LESSON_ID } },
    });
    expect(progress?.status ?? 'not_started').not.toBe('completed');
  });
});

describe('A11 placement', () => {
  const answers = (correct: string[]) =>
    Object.fromEntries(
      ['p1', 'p2', 'p3', 'p4', 'p5'].map((id, i) => [
        id,
        { selectedOptionIds: [correct[i] ?? 'wrong'] },
      ]),
    );

  it('hides answers and critical flags before submission', async () => {
    const response = await client.request('GET', api(`/placements/${CHAPTER_ID}`));
    expect(response.statusCode).toBe(200);
    const serialised = JSON.stringify(response.json());
    expect(serialised).not.toContain('"correct"');
    expect(serialised).not.toContain('"critical"');
    expect(serialised).not.toContain('Why a is right');
  });

  it('qualifies at four of five with the critical item correct', async () => {
    const assessmentVersionId = versions.get(ASSESSMENT_ID);
    const response = await client.request('POST', api(`/placements/${CHAPTER_ID}`), {
      clientEventId: uuid(),
      assessmentVersionId,
      answers: answers(['a', 'b', 'c', 'd', 'wrong']),
    });
    const data = (response.json() as { data: Record<string, unknown> }).data;
    expect(data.score).toBe(4);
    expect(data.qualified).toBe(true);
    expect(data.placedOut).toBe(true);
    expect(data.xpAwarded).toBe(0);

    const placement = await db.chapterPlacement.findUnique({
      where: { userId_chapterId: { userId: ownerId, chapterId: CHAPTER_ID } },
    });
    expect(placement?.placedOut).toBe(true);

    // Placing out is not lesson completion.
    expect(await db.lessonProgress.count({ where: { userId: ownerId, status: 'completed' } })).toBe(0);
  });

  it('does not qualify when the critical item is wrong, even at four of five', async () => {
    const response = await client.request('POST', api(`/placements/${CHAPTER_ID}`), {
      clientEventId: uuid(),
      assessmentVersionId: versions.get(ASSESSMENT_ID),
      answers: answers(['wrong', 'b', 'c', 'd', 'e']),
    });
    const data = (response.json() as { data: Record<string, unknown> }).data;
    expect(data.score).toBe(4);
    expect(data.qualified).toBe(false);
    expect(data.failedCriticalItemIds).toEqual(['p1']);
  });

  it('marks a repeat on the same version as practice only and does not place out', async () => {
    const assessmentVersionId = versions.get(ASSESSMENT_ID);
    await client.request('POST', api(`/placements/${CHAPTER_ID}`), {
      clientEventId: uuid(),
      assessmentVersionId,
      answers: answers(['wrong', 'wrong', 'wrong', 'wrong', 'wrong']),
    });
    const second = await client.request('POST', api(`/placements/${CHAPTER_ID}`), {
      clientEventId: uuid(),
      assessmentVersionId,
      answers: answers(['a', 'b', 'c', 'd', 'e']),
    });
    const data = (second.json() as { data: Record<string, unknown> }).data;
    expect(data.score).toBe(5);
    expect(data.practiceOnly).toBe(true);
    expect(data.placedOut).toBe(false);

    const placement = await db.chapterPlacement.findUnique({
      where: { userId_chapterId: { userId: ownerId, chapterId: CHAPTER_ID } },
    });
    expect(placement?.placedOut ?? false).toBe(false);
  });

  it('leaves manual skipping available regardless of the placement score', async () => {
    await client.request('POST', api(`/placements/${CHAPTER_ID}`), {
      clientEventId: uuid(),
      assessmentVersionId: versions.get(ASSESSMENT_ID),
      answers: answers(['wrong', 'wrong', 'wrong', 'wrong', 'wrong']),
    });
    const skip = await client.request('POST', api(`/lessons/${LESSON_ID}/skip`), {
      clientEventId: uuid(),
    });
    expect(skip.statusCode).toBe(200);
  });
});

describe('curriculum reads', () => {
  it('serves the catalogue with real progress and no invented statistics', async () => {
    const response = await client.request('GET', api('/curriculum'));
    expect(response.statusCode).toBe(200);
    const tracks = (response.json() as { data: { chapters: { lessonCount: number; completedLessonCount: number }[] }[] })
      .data;
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.chapters[0]?.lessonCount).toBe(2);
    expect(tracks[0]?.chapters[0]?.completedLessonCount).toBe(0);
  });

  it('serves a chapter with its lesson summaries', async () => {
    const response = await client.request('GET', api(`/chapters/${CHAPTER_ID}`));
    const data = (response.json() as { data: { lessons: { id: string; status: string }[] } }).data;
    expect(data.lessons.map((l) => l.id)).toEqual([LESSON_ID, 'v1-l09']);
    expect(data.lessons[0]?.status).toBe('not_started');
  });
});
