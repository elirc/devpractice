import { PrismaClient, TicketStatus } from '@prisma/client';
import { buildApp } from '../src/app.js';

/**
 * Integration tests run against a REAL PostgreSQL database, not a mock.
 * A mocked repository cannot reproduce the ordering and paging behaviour these
 * tests exist to pin down.
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
 * THE SEARCH FIXTURE.
 *
 * Deliberate properties, each of which some naive implementation gets wrong:
 *
 *  - Six tickets match the word "printer", and they are NOT contiguous in the
 *    full ordering, so a filter applied after paging returns short pages.
 *  - All six share ONE createdAt value. Ordering by createdAt alone is not a
 *    total order, so paging that ignores the tiebreaker repeats or skips rows.
 *  - The word appears in three different columns: title, body and
 *    customerName. Searching only the title misses matches.
 *  - Casing varies ("Printer", "printer", "PRINTER"), so a case-sensitive
 *    match misses matches.
 *  - Two tickets contain "print" but not "printer" (a "printing schedule" and
 *    a "blueprint"), which a too-loose match wrongly includes.
 */
export const SHARED_TIMESTAMP = '2026-09-04T10:00:00.000Z';

export const SEARCH_MATCHES = [
  'search-p-1',
  'search-p-2',
  'search-p-3',
  'search-p-4',
  'search-p-5',
  'search-p-6',
] as const;

export async function seedSearchFixture(): Promise<void> {
  const shared = new Date(SHARED_TIMESTAMP);
  const earlier = new Date('2026-09-03T08:00:00.000Z');

  await prisma.ticket.createMany({
    data: [
      // --- the six matches, all sharing one timestamp ---
      { id: 'search-p-1', title: 'Printer jams on every duplex job', body: 'Tray 2 only.', customerName: 'Brightleaf Bakery', ownerId: 'user-dana', status: TicketStatus.open, createdAt: shared },
      { id: 'search-p-2', title: 'Label alignment drifts', body: 'The printer output is 3mm low.', customerName: 'Orrin Cycles', ownerId: 'user-dana', status: TicketStatus.pending, createdAt: shared },
      { id: 'search-p-3', title: 'Cannot connect from the back office', body: 'Device unreachable.', customerName: 'Printer Parts Direct', ownerId: 'user-ravi', status: TicketStatus.open, createdAt: shared },
      { id: 'search-p-4', title: 'PRINTER offline after firmware update', body: 'Rolled back, still offline.', customerName: 'Halden Legal', ownerId: 'user-ravi', status: TicketStatus.open, createdAt: shared },
      { id: 'search-p-5', title: 'Receipt roll feeds twice', body: 'Happens on the till printer only.', customerName: 'Kestrel Freight', ownerId: 'user-dana', status: TicketStatus.closed, createdAt: shared },
      { id: 'search-p-6', title: 'printer queue never clears', body: 'Jobs stack up overnight.', customerName: 'Vellum Studio', ownerId: 'user-ravi', status: TicketStatus.pending, createdAt: shared },

      // --- near misses: contain "print" but not "printer" ---
      { id: 'search-n-1', title: 'Printing schedule is wrong', body: 'The weekly run starts late.', customerName: 'Halden Legal', ownerId: 'user-dana', status: TicketStatus.open, createdAt: earlier },
      { id: 'search-n-2', title: 'Blueprint export is blank', body: 'The PDF has no layers.', customerName: 'Orrin Cycles', ownerId: 'user-ravi', status: TicketStatus.open, createdAt: earlier },

      // --- unrelated noise, interleaved so matches are not contiguous ---
      { id: 'search-x-1', title: 'Card reader rejects chip payments', body: 'Contactless works.', customerName: 'Brightleaf Bakery', ownerId: 'user-dana', status: TicketStatus.open, createdAt: new Date('2026-09-03T09:00:00.000Z') },
      { id: 'search-x-2', title: 'Invoice repeats last month total', body: 'September shows August.', customerName: 'Halden Legal', ownerId: 'user-dana', status: TicketStatus.pending, createdAt: new Date('2026-09-03T10:00:00.000Z') },
      { id: 'search-x-3', title: 'Password reset email never arrives', body: 'Two staff affected.', customerName: 'Vellum Studio', ownerId: 'user-ravi', status: TicketStatus.closed, createdAt: new Date('2026-09-05T09:00:00.000Z') },
      { id: 'search-x-4', title: 'Export produces an empty spreadsheet', body: 'Header row only.', customerName: 'Kestrel Freight', ownerId: 'user-dana', status: TicketStatus.open, createdAt: new Date('2026-09-05T11:00:00.000Z') },
    ],
  });
}

/** Page through a listing, following nextCursor until it runs out. */
export async function pageThrough(
  app: ReturnType<typeof buildApp>,
  baseUrl: string,
  limit: number,
): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;

  // A guard, so a broken cursor loops a bounded number of times rather than
  // hanging the suite.
  while (pages < 50) {
    const joiner = baseUrl.includes('?') ? '&' : '?';
    const url = `${baseUrl}${joiner}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const response = await app.inject({ method: 'GET', url });
    if (response.statusCode !== 200) {
      throw new Error(`Listing failed with ${response.statusCode}: ${response.body}`);
    }
    const payload = response.json() as {
      data: { id: string }[];
      meta: { nextCursor: string | null; hasMore: boolean };
    };
    ids.push(...payload.data.map((row) => row.id));
    pages += 1;
    cursor = payload.meta.nextCursor;
    if (!cursor) break;
  }

  return { ids, pages };
}
