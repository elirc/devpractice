import { PrismaClient } from '@prisma/client';

/**
 * One Prisma client for the support-desk LEARNING database.
 *
 * Under a test run the client uses TEST_DATABASE_URL, so a test run never
 * touches the data you seeded for development.
 *
 * This client also EMITS QUERY EVENTS. That is what lets the mission checks
 * count how many round trips a request makes. It is measurement infrastructure,
 * not part of the assignment — you should not need to change this file.
 */
const isTestRun = process.env.VITEST !== undefined || process.env.NODE_ENV === 'test';
const url = isTestRun
  ? (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL)
  : process.env.DATABASE_URL;

export const prisma = new PrismaClient({
  log: [{ emit: 'event', level: 'query' }],
  ...(url ? { datasources: { db: { url } } } : {}),
});

/**
 * Queries are recorded only while a measurement is active. Prisma's event
 * emitter has no `off()`, so ONE listener is registered for the process and it
 * writes into whichever recorder is currently open. Registering a listener per
 * measurement would leak them and cross-contaminate counts.
 */
let recorder: string[] | null = null;

prisma.$on('query', (event) => {
  if (!recorder) return;
  const sql = event.query.trim();
  // Transaction bookkeeping is noise for this measurement: counting it would
  // change the number depending on whether a solution opened a transaction.
  if (/^(BEGIN|COMMIT|ROLLBACK|DEALLOCATE|SET |SELECT 1)/i.test(sql)) return;
  recorder.push(sql);
});

export interface QueryMeasurement<T> {
  result: T;
  count: number;
  queries: string[];
}

/** Count the database round trips issued while `run` executes. */
export async function countQueries<T>(run: () => Promise<T>): Promise<QueryMeasurement<T>> {
  const collected: string[] = [];
  recorder = collected;
  try {
    const result = await run();
    // Prisma emits query events asynchronously; yield so late events are
    // recorded before the count is read.
    await new Promise((resolve) => setTimeout(resolve, 60));
    return { result, count: collected.length, queries: [...collected] };
  } finally {
    recorder = null;
  }
}
