import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Client, buildTestApp, createOwner, uuid } from '../helpers/app.js';
import { createTestClient, ensureMigrated, resetDatabase } from '../helpers/db.js';
import { seedContentFixture, type ContentFixture } from '../helpers/content.js';
import { FixedClock } from '../../src/lib/clock.js';

let db: PrismaClient;

beforeAll(async () => {
  ensureMigrated();
  db = createTestClient();
});

beforeEach(async () => {
  await resetDatabase(db);
});

afterAll(async () => {
  await db.$disconnect();
});

/** Two owners plus published content, the setup most acceptance checks need. */
async function twoOwners(clock = new FixedClock()) {
  const built = await buildTestApp(db, clock);
  const alice = await createOwner(db, 'alice@example.com');
  const bob = await createOwner(db, 'bob@example.com');
  const fixture = await seedContentFixture(db);

  const aliceClient = new Client(built.app);
  const bobClient = new Client(built.app);
  await aliceClient.login(alice.email, alice.password);
  await bobClient.login(bob.email, bob.password);

  return { ...built, alice, bob, aliceClient, bobClient, fixture };
}

describe('A01 account isolation', () => {
  it('denies every cross-owner read and write', async () => {
    const { app, aliceClient, bobClient, fixture } = await twoOwners();

    // Alice creates one of each owned record.
    const note = await aliceClient.request('POST', '/api/v1/notes', {
      clientEventId: uuid(),
      contentItemId: fixture.lessonId,
      title: "Alice's private note",
      body: 'Only Alice should ever read this.',
    });
    expect(note.statusCode).toBe(201);
    const noteId = (note.json() as { data: { id: string; revision: number } }).data.id;
    const noteRevision = (note.json() as { data: { revision: number } }).data.revision;

    await aliceClient.request('PUT', `/api/v1/drafts/${fixture.exerciseId}`, {
      source: 'function countOpen(t){return t.length;}',
      expectedRevision: 0,
      contentVersionId: fixture.exerciseVersionId,
    });

    await aliceClient.request('PUT', `/api/v1/bookmarks/${fixture.lessonId}`);

    await aliceClient.request('PUT', `/api/v1/missions/${fixture.missionId}/progress`, {
      expectedRevision: 0,
      checklist: { 'list-renders': true },
      status: 'in_progress',
      repositoryUrl: null,
      commitHash: null,
      report: null,
    });

    // Bob must not be able to read or modify any of it.
    const bobReadsNote = await bobClient.request('PATCH', `/api/v1/notes/${noteId}`, {
      title: 'hijacked',
      expectedRevision: noteRevision,
    });
    expect(bobReadsNote.statusCode).toBe(404);

    const bobDeletesNote = await bobClient.request(
      'DELETE',
      `/api/v1/notes/${noteId}?expectedRevision=${noteRevision}`,
    );
    expect(bobDeletesNote.statusCode).toBe(404);

    const bobNotes = await bobClient.request('GET', '/api/v1/notes');
    expect((bobNotes.json() as { data: unknown[] }).data).toHaveLength(0);

    // Bob's draft view for the same exercise is his own (empty), not Alice's.
    const bobDraft = await bobClient.request('GET', `/api/v1/drafts/${fixture.exerciseId}`);
    expect((bobDraft.json() as { data: { source: string | null } }).data.source).toBeNull();

    const bobBookmarks = await bobClient.request('GET', '/api/v1/bookmarks');
    expect((bobBookmarks.json() as { data: unknown[] }).data).toHaveLength(0);

    const bobMission = await bobClient.request('GET', `/api/v1/missions/${fixture.missionId}`);
    expect(
      (bobMission.json() as { data: { progress: { status: string } } }).data.progress.status,
    ).toBe('not_started');

    const bobActivity = await bobClient.request('GET', '/api/v1/activity');
    expect((bobActivity.json() as { data: unknown[] }).data).toHaveLength(0);

    const bobExport = await bobClient.request('GET', '/api/v1/exports/progress');
    expect((bobExport.json() as { data: { notes: unknown[] } }).data.notes).toHaveLength(0);

    await app.close();
  });

  it('rejects unauthenticated access to every data route', async () => {
    const { app, fixture } = await twoOwners();
    const anonymous = new Client(app);

    for (const [method, url] of [
      ['GET', '/api/v1/notes'],
      ['GET', '/api/v1/bookmarks'],
      ['GET', '/api/v1/activity'],
      ['GET', '/api/v1/settings'],
      ['GET', '/api/v1/exports/progress'],
      ['GET', `/api/v1/drafts/${fixture.exerciseId}`],
      ['GET', '/api/v1/missions'],
    ] as const) {
      const response = await anonymous.request(method, url);
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }

    await app.close();
  });
});

describe('A02 durable progress', () => {
  it('keeps saved work across a service restart and a second browser context', async () => {
    const clock = new FixedClock();
    const { app, alice, aliceClient, fixture } = await twoOwners(clock);

    await aliceClient.request('POST', '/api/v1/notes', {
      clientEventId: uuid(),
      contentItemId: fixture.lessonId,
      title: 'Durable note',
      body: 'Survives a restart.',
    });
    await aliceClient.request('PUT', `/api/v1/drafts/${fixture.exerciseId}`, {
      source: 'const answer = 42;',
      expectedRevision: 0,
      contentVersionId: fixture.exerciseVersionId,
    });
    await app.close();

    // Rebuild the app against the same database, sign in fresh: a new device.
    const rebuilt = await buildTestApp(db, clock);
    const secondDevice = new Client(rebuilt.app);
    await secondDevice.login(alice.email, alice.password);

    const notes = await secondDevice.request('GET', '/api/v1/notes');
    const noteData = (notes.json() as { data: { title: string }[] }).data;
    expect(noteData).toHaveLength(1);
    expect(noteData[0]!.title).toBe('Durable note');

    const draft = await secondDevice.request('GET', `/api/v1/drafts/${fixture.exerciseId}`);
    expect((draft.json() as { data: { source: string } }).data.source).toBe('const answer = 42;');

    await rebuilt.app.close();
  });
});

describe('A03 idempotent credit', () => {
  it('creates one note for a replayed clientEventId', async () => {
    const { app, aliceClient, fixture } = await twoOwners();
    const eventId = uuid();
    const payload = {
      clientEventId: eventId,
      contentItemId: fixture.lessonId,
      title: 'Retried note',
      body: 'The network dropped the first response.',
    };

    const first = await aliceClient.request('POST', '/api/v1/notes', payload);
    const second = await aliceClient.request('POST', '/api/v1/notes', payload);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    // Same record returned, not a duplicate created.
    expect((second.json() as { data: { id: string } }).data.id).toBe(
      (first.json() as { data: { id: string } }).data.id,
    );
    expect(await db.note.count()).toBe(1);

    await app.close();
  });

  it('rejects the same event id carrying a different body', async () => {
    const { app, aliceClient } = await twoOwners();
    const eventId = uuid();

    await aliceClient.request('POST', '/api/v1/notes', {
      clientEventId: eventId,
      contentItemId: null,
      title: 'Original',
      body: 'first',
    });
    const conflicting = await aliceClient.request('POST', '/api/v1/notes', {
      clientEventId: eventId,
      contentItemId: null,
      title: 'Different',
      body: 'second',
    });

    expect(conflicting.statusCode).toBe(409);
    expect((conflicting.json() as { error: { code: string } }).error.code).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
    expect(await db.note.count()).toBe(1);

    await app.close();
  });

  it('awards mission XP once even when completion is submitted twice', async () => {
    const { app, aliceClient, fixture } = await twoOwners();

    const first = await aliceClient.request('PUT', `/api/v1/missions/${fixture.missionId}/progress`, {
      expectedRevision: 0,
      checklist: { 'list-renders': true, 'form-validates': true },
      status: 'completed',
      repositoryUrl: 'https://github.com/example/support-desk',
      commitHash: null,
      report: { testCommand: 'pnpm test:mission', reportedOutcome: 'passing', notes: '' },
    });
    expect(first.statusCode).toBe(200);
    const revision = (first.json() as { data: { revision: number } }).data.revision;

    await aliceClient.request('PUT', `/api/v1/missions/${fixture.missionId}/progress`, {
      expectedRevision: revision,
      checklist: { 'list-renders': true, 'form-validates': true },
      status: 'completed',
      repositoryUrl: 'https://github.com/example/support-desk',
      commitHash: null,
      report: { testCommand: 'pnpm test:mission', reportedOutcome: 'passing', notes: 'again' },
    });

    const awards = await db.xpAward.findMany();
    expect(awards).toHaveLength(1);
    expect(awards[0]!.amount).toBe(50);

    await app.close();
  });
});

describe('A04 conflicting edits preserve both texts', () => {
  it('refuses a stale draft save and returns the server version', async () => {
    const { app, alice, aliceClient, fixture } = await twoOwners();

    const laptop = aliceClient;
    const phone = new Client(app);
    await phone.login(alice.email, alice.password);

    const created = await laptop.request('PUT', `/api/v1/drafts/${fixture.exerciseId}`, {
      source: 'const from = "laptop";',
      expectedRevision: 0,
      contentVersionId: fixture.exerciseVersionId,
    });
    const revision = (created.json() as { data: { revision: number } }).data.revision;

    // Phone saves first against the shared revision.
    const phoneSave = await phone.request('PUT', `/api/v1/drafts/${fixture.exerciseId}`, {
      source: 'const from = "phone";',
      expectedRevision: revision,
      contentVersionId: fixture.exerciseVersionId,
    });
    expect(phoneSave.statusCode).toBe(200);

    // Laptop is now stale. Its save must be refused, not applied.
    const laptopSave = await laptop.request('PUT', `/api/v1/drafts/${fixture.exerciseId}`, {
      source: 'const from = "laptop, edited later";',
      expectedRevision: revision,
      contentVersionId: fixture.exerciseVersionId,
    });

    expect(laptopSave.statusCode).toBe(409);
    const conflict = laptopSave.json() as {
      error: { code: string; server: { source: string }; serverRevision: number };
    };
    expect(conflict.error.code).toBe('REVISION_CONFLICT');
    // The server text comes back so the client can show both and let the owner choose.
    expect(conflict.error.server.source).toBe('const from = "phone";');

    // Nothing was overwritten.
    const stored = await db.exerciseDraft.findFirstOrThrow();
    expect(stored.source).toBe('const from = "phone";');

    // And the replaced text is recoverable from the snapshot history.
    const snapshots = await laptop.request('GET', `/api/v1/drafts/${fixture.exerciseId}/snapshots`);
    const history = (snapshots.json() as { data: { source: string }[] }).data;
    expect(history.some((s) => s.source === 'const from = "laptop";')).toBe(true);

    await app.close();
  });

  it('refuses a stale note edit and a stale note delete', async () => {
    const { app, alice, aliceClient } = await twoOwners();
    const phone = new Client(app);
    await phone.login(alice.email, alice.password);

    const created = await aliceClient.request('POST', '/api/v1/notes', {
      clientEventId: uuid(),
      contentItemId: null,
      title: 'Shared note',
      body: 'original text',
    });
    const { id, revision } = (created.json() as { data: { id: string; revision: number } }).data;

    const phoneEdit = await phone.request('PATCH', `/api/v1/notes/${id}`, {
      body: 'edited on the phone',
      expectedRevision: revision,
    });
    expect(phoneEdit.statusCode).toBe(200);

    const staleEdit = await aliceClient.request('PATCH', `/api/v1/notes/${id}`, {
      body: 'edited on the laptop',
      expectedRevision: revision,
    });
    expect(staleEdit.statusCode).toBe(409);
    expect(
      (staleEdit.json() as { error: { server: { body: string } } }).error.server.body,
    ).toBe('edited on the phone');

    // A stale client must not be able to resurrect-and-delete either.
    const staleDelete = await aliceClient.request(
      'DELETE',
      `/api/v1/notes/${id}?expectedRevision=${revision}`,
    );
    expect(staleDelete.statusCode).toBe(409);

    const stored = await db.note.findUniqueOrThrow({ where: { id } });
    expect(stored.deletedAt).toBeNull();
    expect(stored.body).toBe('edited on the phone');

    await app.close();
  });
});

describe('A14 network recovery', () => {
  it('lets a client recover by refetching the current revision after a conflict', async () => {
    const { app, alice, aliceClient, fixture } = await twoOwners();
    const phone = new Client(app);
    await phone.login(alice.email, alice.password);

    await aliceClient.request('PUT', `/api/v1/drafts/${fixture.exerciseId}`, {
      source: 'v1',
      expectedRevision: 0,
      contentVersionId: fixture.exerciseVersionId,
    });
    await phone.request('PUT', `/api/v1/drafts/${fixture.exerciseId}`, {
      source: 'v2 from phone',
      expectedRevision: 1,
      contentVersionId: fixture.exerciseVersionId,
    });

    // Stale replay after a dropped connection is refused...
    const staleReplay = await aliceClient.request('PUT', `/api/v1/drafts/${fixture.exerciseId}`, {
      source: 'v2 from laptop',
      expectedRevision: 1,
      contentVersionId: fixture.exerciseVersionId,
    });
    expect(staleReplay.statusCode).toBe(409);

    // ...then succeeds once the client fetches the current revision first.
    const current = await aliceClient.request('GET', `/api/v1/drafts/${fixture.exerciseId}`);
    const currentRevision = (current.json() as { data: { revision: number } }).data.revision;
    const retried = await aliceClient.request('PUT', `/api/v1/drafts/${fixture.exerciseId}`, {
      source: 'merged by the owner',
      expectedRevision: currentRevision,
      contentVersionId: fixture.exerciseVersionId,
    });
    expect(retried.statusCode).toBe(200);

    await app.close();
  });

  it('never applies a stale settings write', async () => {
    const { app, alice, aliceClient } = await twoOwners();
    const phone = new Client(app);
    await phone.login(alice.email, alice.password);

    const initial = await aliceClient.request('GET', '/api/v1/settings');
    const revision = (initial.json() as { data: { revision: number } }).data.revision;

    await phone.request('PATCH', '/api/v1/settings', { expectedRevision: revision, theme: 'dark' });
    const stale = await aliceClient.request('PATCH', '/api/v1/settings', {
      expectedRevision: revision,
      theme: 'light',
    });

    expect(stale.statusCode).toBe(409);
    const user = await db.user.findUniqueOrThrow({ where: { id: alice.id } });
    expect(user.theme).toBe('dark');

    await app.close();
  });
});

describe('mission reports are never treated as verified', () => {
  it('labels stored and returned mission outcomes as self-reported', async () => {
    const { app, aliceClient, fixture } = await twoOwners();

    const response = await aliceClient.request(
      'PUT',
      `/api/v1/missions/${fixture.missionId}/progress`,
      {
        expectedRevision: 0,
        checklist: { 'list-renders': true },
        status: 'completed',
        repositoryUrl: 'https://github.com/example/support-desk',
        commitHash: 'a1b2c3d',
        report: { testCommand: 'pnpm test:mission', reportedOutcome: 'passing', notes: 'done' },
      },
    );

    expect(response.statusCode).toBe(200);
    expect((response.json() as { data: { verification: string } }).data.verification).toBe(
      'self_reported',
    );

    const stored = await db.missionProgress.findFirstOrThrow();
    expect((stored.report as { verification: string }).verification).toBe('self_reported');

    await app.close();
  });

  it('rejects a repository URL carrying embedded credentials', async () => {
    const { app, aliceClient, fixture } = await twoOwners();

    const response = await aliceClient.request(
      'PUT',
      `/api/v1/missions/${fixture.missionId}/progress`,
      {
        expectedRevision: 0,
        checklist: {},
        status: 'in_progress',
        repositoryUrl: 'https://user:secret@github.com/example/private',
        commitHash: null,
        report: null,
      },
    );

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
