import { PrismaClient, TicketStatus } from '@prisma/client';
import { buildApp } from '../src/app.js';

export { countQueries } from '../src/db.js';

/**
 * Integration tests run against a REAL PostgreSQL database. A mock cannot tell
 * you how many round trips a request made, which is the entire measurement
 * this mission turns on.
 */
const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL (or DATABASE_URL) before running tests.');

export const prisma = new PrismaClient({ datasources: { db: { url } } });

export function testApp() {
  return buildApp();
}

export async function resetDatabase(): Promise<void> {
  await prisma.comment.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.trainingUser.deleteMany();
  await prisma.trainingUser.createMany({
    data: [
      { id: 'user-dana', displayName: 'Dana (dispatcher)' },
      { id: 'user-ravi', displayName: 'Ravi (dispatcher)' },
    ],
  });
}

/**
 * Seed `ticketCount` tickets with a VARYING number of comments each, including
 * some with none.
 *
 * The variation matters. A solution that returns a count for every ticket by
 * joining and grouping must still report 0 — not omit the row — for a ticket
 * with no comments. Uniform fixtures hide that bug.
 */
export async function seedDashboardFixture(ticketCount: number): Promise<void> {
  const base = Date.parse('2026-09-01T00:00:00.000Z');
  const statuses = [TicketStatus.open, TicketStatus.pending, TicketStatus.closed];

  await prisma.ticket.createMany({
    data: Array.from({ length: ticketCount }, (_, index) => ({
      id: `dash-${String(index).padStart(3, '0')}`,
      title: `Dashboard ticket ${index}`,
      body: `Body ${index}`,
      customerName: `Customer ${index}`,
      status: statuses[index % 3],
      ownerId: index % 2 === 0 ? 'user-dana' : 'user-ravi',
      createdAt: new Date(base + index * 60_000),
    })),
  });

  const comments: {
    id: string;
    ticketId: string;
    authorId: string;
    body: string;
    createdAt: Date;
  }[] = [];

  for (let index = 0; index < ticketCount; index += 1) {
    // 0, 1, 2 or 3 comments, cycling — so some tickets genuinely have none.
    const count = index % 4;
    for (let n = 0; n < count; n += 1) {
      comments.push({
        id: `dash-c-${index}-${n}`,
        ticketId: `dash-${String(index).padStart(3, '0')}`,
        authorId: n % 2 === 0 ? 'user-dana' : 'user-ravi',
        body: `Comment ${n} on ticket ${index}`,
        createdAt: new Date(base + index * 60_000 + (n + 1) * 1_000),
      });
    }
  }

  if (comments.length > 0) await prisma.comment.createMany({ data: comments });
}

/**
 * What the dashboard must return, computed independently of the route.
 * The mission is to change HOW the route gets this, never WHAT it returns.
 */
export async function expectedDashboard(limit: number): Promise<
  { id: string; commentCount: number; latestCommentBody: string | null }[]
> {
  const tickets = await prisma.ticket.findMany({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });

  const rows: { id: string; commentCount: number; latestCommentBody: string | null }[] = [];
  for (const ticket of tickets) {
    const commentCount = await prisma.comment.count({ where: { ticketId: ticket.id } });
    const latest = await prisma.comment.findFirst({
      where: { ticketId: ticket.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { body: true },
    });
    rows.push({ id: ticket.id, commentCount, latestCommentBody: latest?.body ?? null });
  }
  return rows;
}
