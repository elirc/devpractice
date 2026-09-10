/**
 * BASELINE checks — these MUST pass on a fresh checkout.
 * They prove the database, the migrations and the server scaffold work.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { prisma, resetDatabase, testApp } from './helpers.js';

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

  it('enforces the comment -> ticket foreign key at the database level', async () => {
    await expect(
      prisma.comment.create({
        data: { ticketId: 'no-such-ticket', authorId: 'user-dana', body: 'orphan' },
      }),
    ).rejects.toBeTruthy();
  });

  it('serves the health route', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
