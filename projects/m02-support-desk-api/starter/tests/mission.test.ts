/**
 * MISSION checks — these FAIL on a fresh checkout. That is the assignment.
 */
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { prisma, resetDatabase, seedTickets, testApp } from './helpers.js';

const asDana = { 'x-training-user': 'user-dana' };

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /tickets', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates a ticket and returns 201 with the stored record', async () => {
    const app = testApp();
    const response = await app.inject({
      method: 'POST',
      url: '/tickets',
      headers: asDana,
      payload: { title: 'Scanner feeds two pages', body: 'Flatbed feeder only.', customerName: 'Marlow Print' },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.data.title).toBe('Scanner feeds two pages');
    expect(body.data.status).toBe('open');
    await expect(prisma.ticket.count()).resolves.toBe(1);
    await app.close();
  });

  it('rejects a whitespace-only title and writes NO rows', async () => {
    const app = testApp();
    const response = await app.inject({
      method: 'POST',
      url: '/tickets',
      headers: asDana,
      payload: { title: '   ', body: 'x', customerName: 'Marlow Print' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.fieldErrors).toHaveProperty('title');
    await expect(prisma.ticket.count()).resolves.toBe(0);
    await app.close();
  });

  it('trims the stored title', async () => {
    const app = testApp();
    await app.inject({
      method: 'POST',
      url: '/tickets',
      headers: asDana,
      payload: { title: '  Trimmed title  ', body: 'x', customerName: 'Marlow Print' },
    });
    const stored = await prisma.ticket.findFirst();
    expect(stored?.title).toBe('Trimmed title');
    await app.close();
  });
});

describe('GET /tickets', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns an empty page when there are no tickets', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/tickets', headers: asDana });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toEqual([]);
    expect(body.meta.nextCursor).toBeNull();
    await app.close();
  });

  it('bounds the page size a caller can ask for', async () => {
    await seedTickets(30);
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/tickets?limit=10000', headers: asDana });
    expect(response.statusCode).toBeLessThan(500);
    if (response.statusCode === 200) {
      expect(response.json().data.length).toBeLessThanOrEqual(100);
    }
    await app.close();
  });

  it('pages through every ticket exactly once, with no duplicates', async () => {
    await seedTickets(25);
    const app = testApp();

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const url = cursor ? '/tickets?limit=7&cursor=' + encodeURIComponent(cursor) : '/tickets?limit=7';
      const response = await app.inject({ method: 'GET', url, headers: asDana });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      for (const ticket of body.data) seen.push(ticket.id);
      cursor = body.meta.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    await app.close();
  });

  it('uses a total order, so tickets sharing a timestamp still page correctly', async () => {
    await seedTickets(10);
    const app = testApp();
    const first = await app.inject({ method: 'GET', url: '/tickets?limit=3', headers: asDana });
    const firstIds = first.json().data.map((t: { id: string }) => t.id);
    const again = await app.inject({ method: 'GET', url: '/tickets?limit=3', headers: asDana });
    // The same query twice must return the same rows in the same order.
    expect(again.json().data.map((t: { id: string }) => t.id)).toEqual(firstIds);
    await app.close();
  });
});

describe('GET /tickets/:id', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('returns the ticket', async () => {
    await seedTickets(1);
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/tickets/fixture-000', headers: asDana });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.id).toBe('fixture-000');
    await app.close();
  });

  it('returns 404 for an unknown id, not 500 and not an empty 200', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/tickets/does-not-exist', headers: asDana });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe('comments', () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedTickets(1);
  });

  it('lists comments for one ticket', async () => {
    await prisma.comment.create({
      data: { id: 'c-1', ticketId: 'fixture-000', authorId: 'user-dana', body: 'First look' },
    });
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/tickets/fixture-000/comments', headers: asDana });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(1);
    await app.close();
  });

  it('rejects a comment on a ticket that does not exist', async () => {
    const app = testApp();
    const response = await app.inject({
      method: 'POST',
      url: '/tickets/no-such-ticket/comments',
      headers: asDana,
      payload: { body: 'orphan comment' },
    });
    expect(response.statusCode).toBe(404);
    await expect(prisma.comment.count()).resolves.toBe(0);
    await app.close();
  });

  it('rejects an empty comment body without writing a row', async () => {
    const app = testApp();
    const response = await app.inject({
      method: 'POST',
      url: '/tickets/fixture-000/comments',
      headers: asDana,
      payload: { body: '   ' },
    });
    expect(response.statusCode).toBe(400);
    await expect(prisma.comment.count()).resolves.toBe(0);
    await app.close();
  });
});
