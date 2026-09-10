/**
 * SECURITY regression checks — the mission.
 *
 * These FAIL on a fresh checkout. Each one describes a way the current code
 * lets one dispatcher reach another dispatcher's data.
 *
 * Documented policy for this API: a resource the caller may not access is
 * reported as **404 Not Found**, never 403. Confirming that a record exists is
 * itself a disclosure, so inaccessible and non-existent must be indistinguishable.
 */
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { prisma, resetDatabase, testApp } from './helpers.js';

const asDana = { 'x-training-user': 'user-dana' };
const asRavi = { 'x-training-user': 'user-ravi' };

/** Dana owns this ticket. Ravi must not be able to reach it in any way. */
async function seedTwoOwners(): Promise<void> {
  await resetDatabase();
  await prisma.ticket.create({
    data: {
      id: 'dana-ticket',
      title: 'Card reader rejects every chip payment',
      body: 'Confidential detail belonging to Dana.',
      customerName: 'Brightleaf Bakery',
      ownerId: 'user-dana',
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    },
  });
  await prisma.ticket.create({
    data: {
      id: 'ravi-ticket',
      title: 'Cannot add a second delivery address',
      body: 'Belongs to Ravi.',
      customerName: 'Orrin Cycles',
      ownerId: 'user-ravi',
      createdAt: new Date('2026-09-02T10:00:00.000Z'),
    },
  });
  await prisma.comment.create({
    data: {
      id: 'dana-comment',
      ticketId: 'dana-ticket',
      authorId: 'user-dana',
      body: 'Internal note only Dana should see.',
    },
  });
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('reading another dispatcher’s ticket', () => {
  beforeEach(seedTwoOwners);

  it('does not return the ticket to a different owner', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/tickets/dana-ticket', headers: asRavi });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('still returns the ticket to its owner', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/tickets/dana-ticket', headers: asDana });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.id).toBe('dana-ticket');
    await app.close();
  });

  it('leaks no foreign data in the response body', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/tickets/dana-ticket', headers: asRavi });
    const text = response.body;
    expect(text).not.toMatch(/Brightleaf Bakery/);
    expect(text).not.toMatch(/Confidential detail/);
    expect(text).not.toMatch(/Dana/);
    await app.close();
  });
});

describe('editing another dispatcher’s ticket', () => {
  beforeEach(seedTwoOwners);

  it('refuses the edit', async () => {
    const app = testApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/tickets/dana-ticket',
      headers: asRavi,
      payload: { status: 'closed' },
    });
    expect(response.statusCode).toBe(404);
    const stored = await prisma.ticket.findUnique({ where: { id: 'dana-ticket' } });
    expect(stored?.status).toBe('open');
    await app.close();
  });

  it('does not name the real owner or customer in the refusal', async () => {
    const app = testApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/tickets/dana-ticket',
      headers: asRavi,
      payload: { status: 'closed' },
    });
    expect(response.body).not.toMatch(/Dana/);
    expect(response.body).not.toMatch(/Brightleaf Bakery/);
    await app.close();
  });

  it('is indistinguishable from a ticket that does not exist', async () => {
    const app = testApp();
    const foreign = await app.inject({
      method: 'PATCH',
      url: '/tickets/dana-ticket',
      headers: asRavi,
      payload: { status: 'closed' },
    });
    const missing = await app.inject({
      method: 'PATCH',
      url: '/tickets/no-such-ticket',
      headers: asRavi,
      payload: { status: 'closed' },
    });
    expect(foreign.statusCode).toBe(missing.statusCode);
    expect(foreign.json().error.code).toBe(missing.json().error.code);
    await app.close();
  });
});

describe('commenting on another dispatcher’s ticket', () => {
  beforeEach(seedTwoOwners);

  it('does not list the comments', async () => {
    const app = testApp();
    const response = await app.inject({
      method: 'GET',
      url: '/tickets/dana-ticket/comments',
      headers: asRavi,
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toMatch(/Internal note/);
    await app.close();
  });

  it('does not accept a new comment, and writes no row', async () => {
    const app = testApp();
    const before = await prisma.comment.count();
    const response = await app.inject({
      method: 'POST',
      url: '/tickets/dana-ticket/comments',
      headers: asRavi,
      payload: { body: 'I should not be able to write here.' },
    });
    expect(response.statusCode).toBe(404);
    await expect(prisma.comment.count()).resolves.toBe(before);
    await app.close();
  });

  it('still lets the owner read and write comments', async () => {
    const app = testApp();
    const list = await app.inject({ method: 'GET', url: '/tickets/dana-ticket/comments', headers: asDana });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);

    const created = await app.inject({
      method: 'POST',
      url: '/tickets/dana-ticket/comments',
      headers: asDana,
      payload: { body: 'Following up with the customer.' },
    });
    expect(created.statusCode).toBe(201);
    await app.close();
  });
});

describe('list scoping', () => {
  beforeEach(seedTwoOwners);

  it('shows each dispatcher only their own tickets', async () => {
    const app = testApp();
    const dana = await app.inject({ method: 'GET', url: '/tickets', headers: asDana });
    const ravi = await app.inject({ method: 'GET', url: '/tickets', headers: asRavi });

    expect(dana.json().data.map((t: { id: string }) => t.id)).toEqual(['dana-ticket']);
    expect(ravi.json().data.map((t: { id: string }) => t.id)).toEqual(['ravi-ticket']);
    await app.close();
  });

  it('cannot be widened with a crafted cursor', async () => {
    const app = testApp();
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: '2020-01-01T00:00:00.000Z', id: '' }),
      'utf8',
    ).toString('base64url');
    const response = await app.inject({
      method: 'GET',
      url: '/tickets?cursor=' + encodeURIComponent(cursor),
      headers: asRavi,
    });
    const ids = response.json().data.map((t: { id: string }) => t.id);
    expect(ids).not.toContain('dana-ticket');
    await app.close();
  });
});
