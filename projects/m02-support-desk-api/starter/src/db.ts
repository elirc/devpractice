import { PrismaClient } from '@prisma/client';

/**
 * One Prisma client for the support-desk LEARNING database.
 *
 * Under a test run the client must use TEST_DATABASE_URL. The test helpers
 * truncate and re-seed between cases, and if the application connected to
 * DATABASE_URL instead, two things would go wrong: a test run would wipe the
 * development data you seeded, and the fixtures a test just created would be
 * invisible to the route under test. That mismatch makes a correct
 * implementation look broken, so it is resolved here rather than in the
 * assignment.
 */
const isTestRun = process.env.VITEST !== undefined || process.env.NODE_ENV === 'test';
const url = isTestRun
  ? (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL)
  : process.env.DATABASE_URL;

export const prisma = url
  ? new PrismaClient({ datasources: { db: { url } } })
  : new PrismaClient();
