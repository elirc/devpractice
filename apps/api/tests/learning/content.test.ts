import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { Client, buildTestApp, createOwner, uuid } from '../helpers/app.js';
import { createTestClient, resetDatabase } from '../helpers/db.js';
import {
  ALL_ITEMS,
  CHOICE_EXERCISE_ID,
  FN_EXERCISE_ID,
  LESSON_ID,
  LESSON_TWO_EXERCISE_ID,
  LESSON_TWO_ID,
  passingRunnerReport,
  publishRelease,
} from './fixtures.js';

let db: PrismaClient;
let app: FastifyInstance;
let client: Client;
let ownerId: string;

const api = (path: string) => `/api/v1${path}`;

function packageOf(
  items: unknown[],
  packageVersion: string,
  baseReleaseId: string | null = null,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    packageId: 'devpractice-v1',
    packageVersion,
    baseReleaseId,
    mode: 'snapshot',
    title: 'DevPractice V1',
    items,
    assets: [],
  };
}

/** Deep clone so a mutation in one test cannot leak into the shared fixture. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

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
  client = new Client(app);
  await client.login(owner.email, owner.password);
});

describe('A09 content validation and atomic publication', () => {
  it('blocks a package whose references do not resolve', async () => {
    const items = clone(ALL_ITEMS) as Record<string, unknown>[];
    const chapter = items.find((i) => i.kind === 'chapter');
    chapter!.lessonIds = [LESSON_ID, 'does-not-exist'];

    const response = await client.request('POST', api('/content/imports'), packageOf(items, '1.0.0'));
    expect(response.statusCode).toBe(422);
    const error = (response.json() as { error: { code: string; errors?: string[] } }).error;
    expect(error.code).toBe('CONTENT_INVALID');
    expect(JSON.stringify(error)).toContain('does-not-exist');
    // Nothing was written.
    expect(await db.contentRelease.count()).toBe(0);
  });

  it('rejects cyclic prerequisites', async () => {
    const items = clone(ALL_ITEMS) as Record<string, unknown>[];
    const lesson = items.find((i) => i.id === LESSON_ID);
    const other = items.find((i) => i.id === LESSON_TWO_ID);
    lesson!.conceptIds = ['a.one'];
    lesson!.prerequisiteIds = ['a.two'];
    other!.conceptIds = ['a.two'];
    other!.prerequisiteIds = ['a.one'];

    const response = await client.request('POST', api('/content/imports'), packageOf(items, '1.0.0'));
    expect(response.statusCode).toBe(422);
    expect(JSON.stringify(response.json())).toContain('cyclic prerequisites');
  });

  it('rejects unsafe markdown links', async () => {
    const items = clone(ALL_ITEMS) as Record<string, unknown>[];
    const lesson = items.find((i) => i.id === LESSON_ID);
    lesson!.bodyMarkdown = 'See [this](javascript:alert(1)) for details.';

    const response = await client.request('POST', api('/content/imports'), packageOf(items, '1.0.0'));
    expect(response.statusCode).toBe(422);
    expect(JSON.stringify(response.json())).toContain('markdown links');
  });

  it('rejects runtime fields smuggled into authored content', async () => {
    const items = clone(ALL_ITEMS) as Record<string, unknown>[];
    const lesson = items.find((i) => i.id === LESSON_ID);
    lesson!.xp = 9999;

    const response = await client.request('POST', api('/content/imports'), packageOf(items, '1.0.0'));
    expect(response.statusCode).toBe(422);
  });

  it('publishes a draft atomically and activates it', async () => {
    const draft = await client.request('POST', api('/content/imports'), packageOf(clone(ALL_ITEMS), '1.0.0'));
    expect(draft.statusCode).toBe(201);
    const { importId, checksum } = (draft.json() as { data: { importId: string; checksum: string } }).data;

    // A draft is invisible to the learner until it is published.
    expect(await db.releaseItem.count()).toBe(0);
    const beforePublish = await client.request('GET', api('/curriculum'));
    expect(beforePublish.statusCode).toBe(404);

    const publish = await client.request('POST', api(`/content/imports/${importId}/publish`), {
      expectedBaseReleaseId: null,
      checksum,
    });
    expect(publish.statusCode).toBe(200);
    expect((publish.json() as { data: { itemCount: number } }).data.itemCount).toBe(ALL_ITEMS.length);

    const curriculum = await client.request('GET', api('/curriculum'));
    expect(curriculum.statusCode).toBe(200);
    const user = await db.user.findUniqueOrThrow({ where: { id: ownerId } });
    expect(user.activeReleaseId).toBe(importId);
  });

  it('returns a conflict when another release was published while the draft was open', async () => {
    const draft = await client.request('POST', api('/content/imports'), packageOf(clone(ALL_ITEMS), '1.0.0'));
    const { importId, checksum } = (draft.json() as { data: { importId: string; checksum: string } }).data;

    // Something else becomes active in the meantime.
    await publishRelease(db, ownerId, clone(ALL_ITEMS) as never, { packageVersion: '0.9.0' });

    const publish = await client.request('POST', api(`/content/imports/${importId}/publish`), {
      expectedBaseReleaseId: null,
      checksum,
    });
    expect(publish.statusCode).toBe(409);
    expect((publish.json() as { error: { code: string } }).error.code).toBe('RELEASE_CONFLICT');
  });

  it('refuses the same packageVersion with different bytes, and replays an identical one', async () => {
    const first = await client.request('POST', api('/content/imports'), packageOf(clone(ALL_ITEMS), '1.0.0'));
    expect(first.statusCode).toBe(201);

    const replay = await client.request('POST', api('/content/imports'), packageOf(clone(ALL_ITEMS), '1.0.0'));
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { data: { replayed: boolean } }).data.replayed).toBe(true);

    const changed = clone(ALL_ITEMS) as Record<string, unknown>[];
    const lesson = changed.find((i) => i.id === LESSON_ID);
    lesson!.summaryMarkdown = 'Different bytes at the same version.';
    const conflict = await client.request('POST', api('/content/imports'), packageOf(changed, '1.0.0'));
    expect(conflict.statusCode).toBe(409);
  });

  it('preserves attempts across an editorial update and keeps the mastery revision', async () => {
    const { versionIdByItemId } = await publishRelease(db, ownerId, clone(ALL_ITEMS) as never, {
      packageVersion: '1.0.0',
    });
    const attempt = await client.request('POST', api('/attempts'), {
      clientEventId: uuid(),
      exerciseId: FN_EXERCISE_ID,
      exerciseVersionId: versionIdByItemId.get(FN_EXERCISE_ID),
      gradingOrigin: 'browser_automated',
      runnerResult: passingRunnerReport(),
    });
    expect(attempt.statusCode).toBe(200);

    const user = await db.user.findUniqueOrThrow({ where: { id: ownerId } });
    const updated = clone(ALL_ITEMS) as Record<string, unknown>[];
    const exercise = updated.find((i) => i.id === FN_EXERCISE_ID);
    exercise!.promptMarkdown = 'Clarified wording, same required behaviour.';

    const draft = await client.request(
      'POST',
      api('/content/imports'),
      packageOf(updated, '1.1.0', user.activeReleaseId),
    );
    const { importId, checksum } = (draft.json() as { data: { importId: string; checksum: string } }).data;
    const publish = await client.request('POST', api(`/content/imports/${importId}/publish`), {
      expectedBaseReleaseId: user.activeReleaseId,
      checksum,
    });
    expect(publish.statusCode).toBe(200);

    // The attempt survives, and the editorial change did not bump mastery.
    expect(await db.attempt.count({ where: { userId: ownerId } })).toBe(1);
    const versions = await db.contentVersion.findMany({
      where: { itemId: FN_EXERCISE_ID },
      orderBy: { version: 'asc' },
    });
    expect(versions).toHaveLength(2);
    expect(versions[1]?.version).toBe(2);
    expect(versions[1]?.masteryRevision).toBe(1);
  });

  it('bumps the mastery revision when required behaviour changes', async () => {
    const { versionIdByItemId } = await publishRelease(db, ownerId, clone(ALL_ITEMS) as never);
    await client.request('POST', api('/attempts'), {
      clientEventId: uuid(),
      exerciseId: CHOICE_EXERCISE_ID,
      exerciseVersionId: versionIdByItemId.get(CHOICE_EXERCISE_ID),
      answer: ['filter'],
      gradingOrigin: 'server_objective',
    });

    const user = await db.user.findUniqueOrThrow({ where: { id: ownerId } });
    const updated = clone(ALL_ITEMS) as Record<string, unknown>[];
    const exercise = updated.find((i) => i.id === CHOICE_EXERCISE_ID) as Record<string, unknown>;
    (exercise.grading as { options: { correct: boolean }[] }).options.push({
      id: 'map',
      textMarkdown: 'tickets.map(...)',
      correct: false,
      explanationMarkdown: 'map transforms.',
    } as never);

    const draft = await client.request(
      'POST',
      api('/content/imports'),
      packageOf(updated, '1.2.0', user.activeReleaseId),
    );
    const { importId, checksum } = (draft.json() as { data: { importId: string; checksum: string } }).data;
    await client.request('POST', api(`/content/imports/${importId}/publish`), {
      expectedBaseReleaseId: user.activeReleaseId,
      checksum,
    });

    const versions = await db.contentVersion.findMany({
      where: { itemId: CHOICE_EXERCISE_ID },
      orderBy: { version: 'asc' },
    });
    expect(versions[1]?.masteryRevision).toBe(2);
    // The original attempt is untouched, still recorded at revision 1.
    const attempt = await db.attempt.findFirstOrThrow({ where: { userId: ownerId } });
    expect(attempt.masteryRevision).toBe(1);
  });
});

describe('A10 archived content', () => {
  it('keeps notes, bookmarks and attempts when an item leaves the active release', async () => {
    const { versionIdByItemId } = await publishRelease(db, ownerId, clone(ALL_ITEMS) as never);
    await client.request('POST', api('/attempts'), {
      clientEventId: uuid(),
      exerciseId: FN_EXERCISE_ID,
      exerciseVersionId: versionIdByItemId.get(FN_EXERCISE_ID),
      gradingOrigin: 'browser_automated',
      runnerResult: passingRunnerReport(),
    });
    await db.note.create({
      data: { userId: ownerId, contentItemId: LESSON_TWO_ID, title: 'My note', body: 'Keep me.' },
    });
    await db.bookmark.create({ data: { userId: ownerId, contentItemId: LESSON_TWO_ID } });

    // Publish a release that drops the second lesson.
    const user = await db.user.findUniqueOrThrow({ where: { id: ownerId } });
    // Dropping the lesson must also drop the exercise that belongs to it,
    // otherwise the package fails reference validation rather than exercising
    // the archiving behaviour under test.
    const trimmed = (clone(ALL_ITEMS) as Record<string, unknown>[]).filter(
      (i) => i.id !== LESSON_TWO_ID && i.id !== LESSON_TWO_EXERCISE_ID,
    );
    const chapter = trimmed.find((i) => i.kind === 'chapter');
    chapter!.lessonIds = [LESSON_ID];

    const draft = await client.request(
      'POST',
      api('/content/imports'),
      packageOf(trimmed, '2.0.0', user.activeReleaseId),
    );
    const body = draft.json() as { data: { importId: string; checksum: string; changeSummary: { archived: string[] } } };
    expect(body.data.changeSummary.archived).toContain(LESSON_TWO_ID);

    const publish = await client.request('POST', api(`/content/imports/${body.data.importId}/publish`), {
      expectedBaseReleaseId: user.activeReleaseId,
      checksum: body.data.checksum,
    });
    expect(publish.statusCode).toBe(200);

    // History survives archiving.
    expect(await db.note.count({ where: { userId: ownerId } })).toBe(1);
    expect(await db.bookmark.count({ where: { userId: ownerId } })).toBe(1);
    expect(await db.attempt.count({ where: { userId: ownerId } })).toBe(1);
    // The archived lesson is gone from ordinary navigation.
    const lesson = await client.request('GET', api(`/lessons/${LESSON_TWO_ID}`));
    expect(lesson.statusCode).toBe(404);
  });
});

describe('A18 release activation', () => {
  it('restores an earlier release without deleting newer attempts or granting old mastery', async () => {
    const first = await publishRelease(db, ownerId, clone(ALL_ITEMS) as never, { packageVersion: '1.0.0' });

    const user = await db.user.findUniqueOrThrow({ where: { id: ownerId } });
    const updated = clone(ALL_ITEMS) as Record<string, unknown>[];
    const exercise = updated.find((i) => i.id === CHOICE_EXERCISE_ID) as Record<string, unknown>;
    (exercise.grading as { options: unknown[] }).options.push({
      id: 'reduce',
      textMarkdown: 'tickets.reduce(...)',
      correct: false,
      explanationMarkdown: 'reduce folds.',
    });

    const draft = await client.request(
      'POST',
      api('/content/imports'),
      packageOf(updated, '2.0.0', user.activeReleaseId),
    );
    const { importId, checksum } = (draft.json() as { data: { importId: string; checksum: string } }).data;
    await client.request('POST', api(`/content/imports/${importId}/publish`), {
      expectedBaseReleaseId: user.activeReleaseId,
      checksum,
    });

    // An attempt against the NEW version.
    const newVersion = await db.contentVersion.findFirstOrThrow({
      where: { itemId: CHOICE_EXERCISE_ID, version: 2 },
    });
    await client.request('POST', api('/attempts'), {
      clientEventId: uuid(),
      exerciseId: CHOICE_EXERCISE_ID,
      exerciseVersionId: newVersion.id,
      answer: ['filter'],
      gradingOrigin: 'server_objective',
    });
    expect(await db.attempt.count({ where: { userId: ownerId } })).toBe(1);

    // Roll back to the first release.
    const activate = await client.request('POST', api(`/content/releases/${first.releaseId}/activate`), {
      expectedActiveReleaseId: importId,
    });
    expect(activate.statusCode).toBe(200);

    const after = await db.user.findUniqueOrThrow({ where: { id: ownerId } });
    expect(after.activeReleaseId).toBe(first.releaseId);
    // Nothing was deleted.
    expect(await db.attempt.count({ where: { userId: ownerId } })).toBe(1);
    expect(await db.contentVersion.count({ where: { itemId: CHOICE_EXERCISE_ID } })).toBe(2);

    // An attempt against a superseded-but-published version still resolves,
    // so in-flight work is never stranded.
    const stillWorks = await client.request('POST', api('/attempts'), {
      clientEventId: uuid(),
      exerciseId: CHOICE_EXERCISE_ID,
      exerciseVersionId: newVersion.id,
      answer: ['filter'],
      gradingOrigin: 'server_objective',
    });
    expect(stillWorks.statusCode).toBe(200);
  });

  it('conflicts when the active release moved on another device', async () => {
    const first = await publishRelease(db, ownerId, clone(ALL_ITEMS) as never, { packageVersion: '1.0.0' });
    const response = await client.request('POST', api(`/content/releases/${first.releaseId}/activate`), {
      expectedActiveReleaseId: null,
    });
    expect(response.statusCode).toBe(409);
  });
});
