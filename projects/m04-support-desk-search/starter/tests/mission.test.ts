/**
 * MISSION checks — these FAIL on a fresh checkout. That is the assignment.
 *
 * They fail because `GET /tickets` ignores `q` entirely, so a search returns
 * every ticket rather than the matching ones. Making them pass means adding
 * search WITHOUT breaking the pagination guarantees the baseline already pins.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  prisma,
  resetDatabase,
  seedSearchFixture,
  testApp,
  pageThrough,
  SEARCH_MATCHES,
} from './helpers.js';

describe('M04 search', () => {
  beforeAll(async () => {
    await resetDatabase();
    await seedSearchFixture();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('narrows the list to matching tickets', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/tickets?q=printer&limit=100' });
    expect(response.statusCode).toBe(200);

    const ids = (response.json() as { data: { id: string }[] }).data.map((row) => row.id);
    expect([...ids].sort()).toEqual([...SEARCH_MATCHES].sort());
  });

  it('matches title, body and customerName, not the title alone', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/tickets?q=printer&limit=100' });
    const ids = (response.json() as { data: { id: string }[] }).data.map((row) => row.id);

    expect(ids, 'search-p-1 matches on title').toContain('search-p-1');
    expect(ids, 'search-p-2 matches on body').toContain('search-p-2');
    expect(ids, 'search-p-3 matches on customerName').toContain('search-p-3');

    // Presence alone would pass on an implementation that ignores `q` and
    // returns every ticket, so also require that unrelated tickets are gone.
    expect(ids, 'an unrelated ticket must not be in a search result').not.toContain('search-x-1');
    expect(ids).toHaveLength(SEARCH_MATCHES.length);
  });

  it('is case-insensitive', async () => {
    const app = testApp();
    const lower = await app.inject({ method: 'GET', url: '/tickets?q=printer&limit=100' });
    const upper = await app.inject({ method: 'GET', url: '/tickets?q=PRINTER&limit=100' });
    const mixed = await app.inject({ method: 'GET', url: '/tickets?q=PrInTeR&limit=100' });

    const idsOf = (r: typeof lower) =>
      (r.json() as { data: { id: string }[] }).data.map((row) => row.id).sort();

    expect(idsOf(lower)).toEqual([...SEARCH_MATCHES].sort());
    expect(idsOf(upper)).toEqual(idsOf(lower));
    expect(idsOf(mixed)).toEqual(idsOf(lower));
  });

  it('does not match a substring the user did not ask for', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/tickets?q=printer&limit=100' });
    const ids = (response.json() as { data: { id: string }[] }).data.map((row) => row.id);

    // "Printing schedule" and "Blueprint export" contain "print", not "printer".
    expect(ids).not.toContain('search-n-1');
    expect(ids).not.toContain('search-n-2');
  });

  it('combines with the status filter', async () => {
    const app = testApp();
    const response = await app.inject({
      method: 'GET',
      url: '/tickets?q=printer&status=open&limit=100',
    });
    expect(response.statusCode).toBe(200);

    const rows = (response.json() as { data: { id: string; status: string }[] }).data;
    expect(rows.every((row) => row.status === 'open')).toBe(true);
    expect(rows.map((row) => row.id).sort()).toEqual(['search-p-1', 'search-p-3', 'search-p-4']);
  });

  it('an empty q behaves like no search at all', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/tickets?q=&limit=100' });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { data: unknown[] }).data).toHaveLength(await prisma.ticket.count());
  });

  it('returns an empty page rather than an error when nothing matches', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/tickets?q=zzz-no-such-text&limit=100' });
    expect(response.statusCode).toBe(200);
    const payload = response.json() as { data: unknown[]; meta: { hasMore: boolean; nextCursor: string | null } };
    expect(payload.data).toEqual([]);
    expect(payload.meta.hasMore).toBe(false);
    expect(payload.meta.nextCursor).toBeNull();
  });

  /**
   * The heart of the mission. All six matches share one createdAt, so a cursor
   * that carries only the timestamp cannot resume unambiguously.
   */
  it('pages through search results returning every match exactly once', async () => {
    const app = testApp();
    const { ids } = await pageThrough(app, '/tickets?q=printer', 2);

    expect(ids, 'no duplicates across pages').toHaveLength(new Set(ids).size);
    expect([...ids].sort(), 'every match, exactly once').toEqual([...SEARCH_MATCHES].sort());
  });

  it('pages correctly at a limit of 1, where every page boundary is a tie', async () => {
    const app = testApp();
    const { ids } = await pageThrough(app, '/tickets?q=printer', 1);

    expect(new Set(ids).size).toBe(SEARCH_MATCHES.length);
    expect([...ids].sort()).toEqual([...SEARCH_MATCHES].sort());
  });

  it('keeps the search applied on every page, not just the first', async () => {
    const app = testApp();
    const first = await app.inject({ method: 'GET', url: '/tickets?q=printer&limit=2' });
    const cursor = (first.json() as { meta: { nextCursor: string | null } }).meta.nextCursor;
    expect(cursor, 'there should be more than one page at limit=2').not.toBeNull();

    const second = await app.inject({
      method: 'GET',
      url: `/tickets?q=printer&limit=2&cursor=${encodeURIComponent(cursor as string)}`,
    });
    expect(second.statusCode).toBe(200);

    const ids = (second.json() as { data: { id: string }[] }).data.map((row) => row.id);
    expect(ids.length).toBeGreaterThan(0);
    // A page that forgot the filter would return non-matching noise tickets.
    expect(ids.every((id) => (SEARCH_MATCHES as readonly string[]).includes(id))).toBe(true);
  });

  /**
   * A cursor is only meaningful for the query that produced it. Reusing one
   * across a different search must not silently return a wrong page: either
   * reject it, or make the cursor carry the filter so it stays correct.
   */
  it('does not silently mis-page when a cursor is reused with different search text', async () => {
    const app = testApp();
    const first = await app.inject({ method: 'GET', url: '/tickets?q=printer&limit=2' });
    const cursor = (first.json() as { meta: { nextCursor: string | null } }).meta.nextCursor as string;

    const reused = await app.inject({
      method: 'GET',
      url: `/tickets?q=invoice&limit=2&cursor=${encodeURIComponent(cursor)}`,
    });

    if (reused.statusCode === 400) {
      expect(reused.json()).toHaveProperty('error');
      return;
    }

    expect(reused.statusCode).toBe(200);
    const ids = (reused.json() as { data: { id: string }[] }).data.map((row) => row.id);
    // Whatever comes back must genuinely match the NEW search.
    const matching = await prisma.ticket.findMany({
      where: {
        OR: [
          { title: { contains: 'invoice', mode: 'insensitive' } },
          { body: { contains: 'invoice', mode: 'insensitive' } },
          { customerName: { contains: 'invoice', mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    const allowed = new Set(matching.map((row) => row.id));
    expect(ids.every((id) => allowed.has(id))).toBe(true);
  });
});
