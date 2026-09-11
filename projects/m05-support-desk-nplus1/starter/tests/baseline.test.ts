/**
 * BASELINE checks — these MUST pass on a fresh checkout.
 *
 * They prove the environment works AND that the dashboard currently returns
 * correct data. That second point matters here: M05 is a performance mission,
 * so the starting position is "right answer, wrong method". These tests pin the
 * right answer so you can tell whether your optimisation changed it.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  prisma,
  resetDatabase,
  seedDashboardFixture,
  expectedDashboard,
  testApp,
} from './helpers.js';

describe('environment', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('connects to the learning database', async () => {
    const rows = await prisma.$queryRaw`SELECT 1 as ok`;
    expect(rows).toBeTruthy();
  });

  it('has the migrated tables', async () => {
    await expect(prisma.ticket.count()).resolves.toBeTypeOf('number');
    await expect(prisma.comment.count()).resolves.toBeTypeOf('number');
  });

  it('serves the health route', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });
});

describe('the dashboard already returns correct data', () => {
  beforeAll(async () => {
    await resetDatabase();
    await seedDashboardFixture(12);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('lists tickets without comment fields when they are not requested', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/tickets?limit=5' });
    expect(response.statusCode).toBe(200);

    const rows = (response.json() as { data: Record<string, unknown>[] }).data;
    expect(rows).toHaveLength(5);
    expect(rows[0]).not.toHaveProperty('commentCount');
  });

  it('returns comment counts and latest comments when asked', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/tickets?withComments=true&limit=12' });
    expect(response.statusCode).toBe(200);

    const rows = (response.json() as {
      data: { id: string; commentCount: number; latestCommentBody: string | null }[];
    }).data;

    const expected = await expectedDashboard(12);
    expect(
      rows.map((row) => ({
        id: row.id,
        commentCount: row.commentCount,
        latestCommentBody: row.latestCommentBody,
      })),
    ).toEqual(expected);
  });

  it('keeps a stable total order across pages', async () => {
    const app = testApp();
    const first = await app.inject({ method: 'GET', url: '/tickets?limit=5' });
    const cursor = (first.json() as { meta: { nextCursor: string | null } }).meta.nextCursor;
    expect(cursor).not.toBeNull();

    const second = await app.inject({
      method: 'GET',
      url: `/tickets?limit=5&cursor=${encodeURIComponent(cursor as string)}`,
    });
    const firstIds = (first.json() as { data: { id: string }[] }).data.map((r) => r.id);
    const secondIds = (second.json() as { data: { id: string }[] }).data.map((r) => r.id);

    expect(new Set([...firstIds, ...secondIds]).size).toBe(firstIds.length + secondIds.length);
  });
});
