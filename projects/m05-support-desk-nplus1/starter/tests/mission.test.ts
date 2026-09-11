/**
 * MISSION checks — these FAIL on a fresh checkout.
 *
 * They do NOT fail because the response is wrong. The starter returns exactly
 * the right data. They fail because of HOW it gets it: one query per ticket for
 * the count and another for the latest comment, so the round trips grow with
 * the page size.
 *
 * The behaviour tests below pass before and after. They are here so that a
 * "faster" solution which quietly changes the answer is caught.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  prisma,
  resetDatabase,
  seedDashboardFixture,
  expectedDashboard,
  testApp,
  countQueries,
} from './helpers.js';

interface DashboardRow {
  id: string;
  commentCount: number;
  latestCommentBody: string | null;
}

async function fetchDashboard(limit: number) {
  const app = testApp();
  return countQueries(async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/tickets?withComments=true&limit=${limit}`,
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { data: DashboardRow[] }).data;
  });
}

describe('M05 dashboard query count', () => {
  beforeAll(async () => {
    await resetDatabase();
    await seedDashboardFixture(24);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('the starter really is N+1, so this suite is measuring something', async () => {
    // A guard on the measurement itself: if countQueries silently recorded
    // nothing, every assertion below would pass vacuously.
    const measured = await fetchDashboard(4);
    expect(measured.count, 'query counting must actually observe queries').toBeGreaterThan(0);
  });

  it('the query count does not grow with the number of tickets', async () => {
    const small = await fetchDashboard(4);
    const large = await fetchDashboard(20);

    expect(small.result).toHaveLength(4);
    expect(large.result).toHaveLength(20);

    // The starter issues roughly 2N+1. A constant-query solution issues the
    // same handful regardless of page size.
    expect(
      large.count,
      `20 tickets took ${large.count} queries and 4 took ${small.count}. ` +
        `The count must not scale with the page.\nQueries:\n${large.queries.join('\n')}`,
    ).toBe(small.count);
  });

  it('a full page of 20 tickets costs a small, bounded number of queries', async () => {
    const measured = await fetchDashboard(20);
    expect(
      measured.count,
      `Expected at most 3 queries for a page of 20; measured ${measured.count}.\n` +
        measured.queries.join('\n'),
    ).toBeLessThanOrEqual(3);
  });

  it('still returns the same rows, counts and latest comments', async () => {
    const measured = await fetchDashboard(20);
    const expected = await expectedDashboard(20);

    expect(measured.result.map((row) => row.id)).toEqual(expected.map((row) => row.id));
    expect(
      measured.result.map((row) => ({
        id: row.id,
        commentCount: row.commentCount,
        latestCommentBody: row.latestCommentBody,
      })),
    ).toEqual(expected);
  });

  it('reports zero, not a missing row, for a ticket with no comments', async () => {
    const measured = await fetchDashboard(20);

    // The fixture gives every 4th ticket no comments at all.
    const empties = measured.result.filter((row) => row.commentCount === 0);
    expect(empties.length).toBeGreaterThan(0);
    expect(empties.every((row) => row.latestCommentBody === null)).toBe(true);

    // And no ticket has been dropped by an inner join.
    expect(measured.result).toHaveLength(20);
  });

  it('picks the LATEST comment, not an arbitrary one', async () => {
    const measured = await fetchDashboard(20);
    const withThree = measured.result.find((row) => row.commentCount === 3);
    expect(withThree, 'the fixture should include a ticket with three comments').toBeDefined();

    const latest = await prisma.comment.findFirst({
      where: { ticketId: (withThree as DashboardRow).id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { body: true },
    });
    expect((withThree as DashboardRow).latestCommentBody).toBe(latest?.body ?? null);
  });

  it('leaves the plain listing untouched and cheap', async () => {
    const app = testApp();
    const measured = await countQueries(async () => {
      const response = await app.inject({ method: 'GET', url: '/tickets?limit=20' });
      expect(response.statusCode).toBe(200);
      return response.json() as { data: DashboardRow[] };
    });

    expect(measured.result.data).toHaveLength(20);
    // No comment fields when they were not requested.
    expect(measured.result.data[0]).not.toHaveProperty('commentCount');
    expect(measured.count).toBeLessThanOrEqual(2);
  });
});
