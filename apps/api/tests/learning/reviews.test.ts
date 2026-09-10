import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { Client, buildTestApp, createOwner, uuid } from '../helpers/app.js';
import { createTestClient, resetDatabase } from '../helpers/db.js';
import { CARD_ID, CARD_TWO_ID, LESSON_ID, publishRelease } from './fixtures.js';

let db: PrismaClient;
let app: FastifyInstance;
let client: Client;
let ownerId: string;
let versions: Map<string, string>;

const api = (path: string) => `/api/v1${path}`;
const DAY = 86_400_000;

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
  await client.login(owner.email, owner.password);
  await client.request('POST', api(`/lessons/${LESSON_ID}/review-cards`), {
    clientEventId: uuid(),
  });
});

async function currentRevision(cardId: string): Promise<number> {
  const state = await db.reviewState.findUniqueOrThrow({
    where: { userId_cardId: { userId: ownerId, cardId } },
  });
  return state.revision;
}

describe('due queue', () => {
  it('returns newly enrolled cards as immediately due with a server timestamp', async () => {
    const response = await client.request('GET', api('/reviews/due'));
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: { cardId: string; step: number }[];
      meta: { serverTime: string; totalDue: number; hasMore: boolean; batchSize: number };
    };
    expect(body.data).toHaveLength(2);
    expect(body.data.every((c) => c.step === 0)).toBe(true);
    expect(body.meta.totalDue).toBe(2);
    expect(body.meta.hasMore).toBe(false);
    expect(body.meta.batchSize).toBe(20);
    expect(Number.isNaN(Date.parse(body.meta.serverTime))).toBe(false);
  });

  it('does not hide remaining work behind a batch: hasMore and nextOffset continue it', async () => {
    const first = await client.request('GET', api('/reviews/due?limit=1'));
    const body = first.json() as { data: unknown[]; meta: { hasMore: boolean; nextOffset: number; totalDue: number } };
    expect(body.data).toHaveLength(1);
    expect(body.meta.hasMore).toBe(true);
    expect(body.meta.totalDue).toBe(2);

    const second = await client.request('GET', api(`/reviews/due?limit=1&offset=${body.meta.nextOffset}`));
    expect((second.json() as { data: unknown[] }).data).toHaveLength(1);
  });

  it('does not surface a card that is not yet due', async () => {
    await client.request('POST', api(`/reviews/${CARD_ID}/responses`), {
      clientEventId: uuid(),
      cardVersionId: versions.get(CARD_ID),
      expectedRevision: await currentRevision(CARD_ID),
      rating: 'good',
      selectedOptionIds: ['new-array'],
    });
    const response = await client.request('GET', api('/reviews/due'));
    const ids = (response.json() as { data: { cardId: string }[] }).data.map((c) => c.cardId);
    expect(ids).not.toContain(CARD_ID);
    expect(ids).toContain(CARD_TWO_ID);
  });
});

describe('review responses', () => {
  it('advances a correct Good answer one step to a one day interval', async () => {
    const before = Date.now();
    const response = await client.request('POST', api(`/reviews/${CARD_ID}/responses`), {
      clientEventId: uuid(),
      cardVersionId: versions.get(CARD_ID),
      expectedRevision: await currentRevision(CARD_ID),
      rating: 'good',
      selectedOptionIds: ['new-array'],
    });
    expect(response.statusCode).toBe(200);
    const data = (response.json() as { data: Record<string, unknown> }).data;
    expect(data.step).toBe(1);
    expect(data.correctness).toBe(true);
    expect(data.effectiveRating).toBe('good');
    expect(data.xpAwarded).toBe(0);
    const dueAt = Date.parse(data.dueAt as string);
    expect(dueAt - before).toBeGreaterThan(DAY - 60_000);
    expect(dueAt - before).toBeLessThan(DAY + 60_000);
  });

  it('forces Again when an objectively graded card is answered incorrectly', async () => {
    const response = await client.request('POST', api(`/reviews/${CARD_ID}/responses`), {
      clientEventId: uuid(),
      cardVersionId: versions.get(CARD_ID),
      expectedRevision: await currentRevision(CARD_ID),
      // The learner claims it was easy; the server checked the answer.
      rating: 'easy',
      selectedOptionIds: ['same-array'],
    });
    const data = (response.json() as { data: Record<string, unknown> }).data;
    expect(data.correctness).toBe(false);
    expect(data.effectiveRating).toBe('again');
    expect(data.ratingWasForced).toBe(true);
    expect(data.step).toBe(0);
  });

  it('accepts a self-rated free-recall card and labels it self_reported', async () => {
    const response = await client.request('POST', api(`/reviews/${CARD_TWO_ID}/responses`), {
      clientEventId: uuid(),
      cardVersionId: versions.get(CARD_TWO_ID),
      expectedRevision: await currentRevision(CARD_TWO_ID),
      rating: 'good',
    });
    const data = (response.json() as { data: Record<string, unknown> }).data;
    expect(data.gradingOrigin).toBe('self_reported');
    expect(data.correctness).toBeNull();
    expect(data.step).toBe(1);
  });

  it('requires an answer for an objectively graded card', async () => {
    const response = await client.request('POST', api(`/reviews/${CARD_ID}/responses`), {
      clientEventId: uuid(),
      cardVersionId: versions.get(CARD_ID),
      expectedRevision: await currentRevision(CARD_ID),
      rating: 'good',
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('A05 review concurrency', () => {
  it('lets only one of two devices holding the same revision schedule the card', async () => {
    const revision = await currentRevision(CARD_ID);
    const payload = (eventId: string) => ({
      clientEventId: eventId,
      cardVersionId: versions.get(CARD_ID),
      expectedRevision: revision,
      rating: 'good' as const,
      selectedOptionIds: ['new-array'],
    });

    const first = await client.request('POST', api(`/reviews/${CARD_ID}/responses`), payload(uuid()));
    // A second device still holding the stale revision submits its own event.
    const second = await client.request('POST', api(`/reviews/${CARD_ID}/responses`), payload(uuid()));

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe('REVISION_CONFLICT');

    // The schedule moved exactly once.
    const state = await db.reviewState.findUniqueOrThrow({
      where: { userId_cardId: { userId: ownerId, cardId: CARD_ID } },
    });
    expect(state.step).toBe(1);
    expect(state.revision).toBe(revision + 1);
    expect(await db.reviewEvent.count({ where: { userId: ownerId, cardId: CARD_ID } })).toBe(1);
  });

  it('returns the original result for a retried event id without rescheduling', async () => {
    const eventId = uuid();
    const payload = {
      clientEventId: eventId,
      cardVersionId: versions.get(CARD_ID),
      expectedRevision: await currentRevision(CARD_ID),
      rating: 'good' as const,
      selectedOptionIds: ['new-array'],
    };

    const first = await client.request('POST', api(`/reviews/${CARD_ID}/responses`), payload);
    const retry = await client.request('POST', api(`/reviews/${CARD_ID}/responses`), payload);

    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    const a = (first.json() as { data: { dueAt: string; revision: number } }).data;
    const b = (retry.json() as { data: { dueAt: string; revision: number } }).data;
    expect(b.dueAt).toBe(a.dueAt);
    expect(b.revision).toBe(a.revision);

    expect(await db.reviewEvent.count({ where: { userId: ownerId, cardId: CARD_ID } })).toBe(1);
    const state = await db.reviewState.findUniqueOrThrow({
      where: { userId_cardId: { userId: ownerId, cardId: CARD_ID } },
    });
    expect(state.step).toBe(1);
  });
});
