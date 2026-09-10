import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';

/**
 * Integration tests run against a REAL PostgreSQL database, not a mock.
 * A mocked repository would not catch the ordering, constraint and pagination
 * defects these tests exist to catch.
 */
const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL (or DATABASE_URL) before running tests.');

export const prisma = new PrismaClient({ datasources: { db: { url } } });

export function testApp() {
  return buildApp();
}

/** Deterministic fixture: fixed ids and fixed timestamps, no clock reads. */
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

export async function seedTickets(count: number, ownerId = 'user-dana'): Promise<void> {
  const base = Date.parse('2026-09-01T00:00:00.000Z');
  await prisma.ticket.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      id: 'fixture-' + String(index).padStart(3, '0'),
      title: 'Fixture ticket ' + index,
      body: 'Body for fixture ticket ' + index,
      customerName: 'Fixture Customer ' + index,
      ownerId,
      // Two tickets deliberately share a timestamp, so ordering by createdAt
      // alone is NOT a total order.
      createdAt: new Date(base + Math.floor(index / 2) * 60000),
    })),
  });
}
