/**
 * BASELINE checks — these MUST pass on a fresh checkout, before you write
 * anything. They prove the database, the migrations, the server and everything
 * M02 already built still work. If one of these fails, your environment is
 * wrong; fix that before starting the mission.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { prisma, resetDatabase, seedSearchFixture, testApp, pageThrough } from './helpers.js';

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
    await expect(prisma.trainingUser.count()).resolves.toBeTypeOf('number');
  });

  it('serves the health route', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('the M02 endpoints still work', () => {
  beforeAll(async () => {
    await resetDatabase();
    await seedSearchFixture();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a ticket', async () => {
    const app = testApp();
    const response = await app.inject({
      method: 'POST',
      url: '/tickets',
      payload: { title: 'Baseline ticket', body: 'x', customerName: 'Baseline Co' },
    });
    expect(response.statusCode).toBe(201);
    await prisma.ticket.delete({ where: { id: (response.json() as { data: { id: string } }).data.id } });
  });

  it('rejects a whitespace-only title without writing anything', async () => {
    const app = testApp();
    const before = await prisma.ticket.count();
    const response = await app.inject({
      method: 'POST',
      url: '/tickets',
      payload: { title: '   ', body: 'x', customerName: 'Baseline Co' },
    });
    expect(response.statusCode).toBe(400);
    expect(await prisma.ticket.count()).toBe(before);
  });

  it('lists tickets in a total order and pages without duplicates', async () => {
    const app = testApp();
    const { ids } = await pageThrough(app, '/tickets', 3);
    const total = await prisma.ticket.count();
    expect(ids).toHaveLength(total);
    expect(new Set(ids).size).toBe(total);
  });

  it('filters by status', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/tickets?status=closed&limit=100' });
    expect(response.statusCode).toBe(200);
    const rows = (response.json() as { data: { status: string }[] }).data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.status === 'closed')).toBe(true);
  });

  it('returns 404 for an unknown ticket', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/tickets/no-such-ticket' });
    expect(response.statusCode).toBe(404);
  });

  it('rejects a malformed cursor', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/tickets?cursor=not-a-cursor' });
    expect(response.statusCode).toBe(400);
  });
});
