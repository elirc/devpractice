import { PrismaClient } from '@prisma/client';

/**
 * One Prisma client for the inventory LEARNING database.
 *
 * Under a test run the client uses TEST_DATABASE_URL. The test helpers truncate
 * and re-seed between cases; if the application connected to DATABASE_URL
 * instead, a test run would wipe your development data AND the fixtures a test
 * just created would be invisible to the route under test, which makes a
 * correct implementation look broken.
 */
const isTestRun = process.env.VITEST !== undefined || process.env.NODE_ENV === 'test';
const url = isTestRun
  ? (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL)
  : process.env.DATABASE_URL;

export const prisma = url
  ? new PrismaClient({ datasources: { db: { url } } })
  : new PrismaClient();
