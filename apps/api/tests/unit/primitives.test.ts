import { describe, expect, it } from 'vitest';
import { canonicalJson, requestHash } from '../../src/lib/idempotency.js';
import { decodeCursor, encodeCursor, buildPage } from '../../src/lib/pagination.js';
import { deriveCsrfToken, hashSessionToken, normalizeEmail, safeEqual } from '../../src/lib/tokens.js';
import { FixedClock } from '../../src/lib/clock.js';
import { loadConfig } from '../../src/config.js';
import { ARGON2_PARAMS, OWASP_ARGON2_FLOOR, checkPasswordPolicy } from '../../src/lib/password.js';

describe('canonical request hashing', () => {
  it('ignores object key order so a reordered retry is still a replay', () => {
    const a = { clientEventId: 'x', title: 'note', body: 'text' };
    const b = { body: 'text', title: 'note', clientEventId: 'x' };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(requestHash('notes.create', a)).toBe(requestHash('notes.create', b));
  });

  it('does not ignore array order, which is semantically meaningful', () => {
    expect(canonicalJson({ ids: [1, 2] })).not.toBe(canonicalJson({ ids: [2, 1] }));
  });

  it('separates operations so the same body under two operations differs', () => {
    const body = { clientEventId: 'x' };
    expect(requestHash('notes.create', body)).not.toBe(requestHash('lessons.skip', body));
  });

  it('treats a changed value as a different request', () => {
    expect(requestHash('n', { title: 'a' })).not.toBe(requestHash('n', { title: 'b' }));
  });
});

describe('cursor pagination', () => {
  it('round-trips a cursor', () => {
    const payload = { ts: '2026-01-01T00:00:00.000Z', id: 'abc' };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('rejects a malformed cursor with a 400-shaped problem', () => {
    expect(() => decodeCursor('not-base64-json')).toThrowError(/cursor/i);
  });

  it('reports hasMore only when an extra row was fetched', () => {
    const rows = [
      { id: 'a', at: new Date('2026-01-03T00:00:00Z') },
      { id: 'b', at: new Date('2026-01-02T00:00:00Z') },
      { id: 'c', at: new Date('2026-01-01T00:00:00Z') },
    ];
    const full = buildPage(rows, 2, (r) => r.at);
    expect(full.items).toHaveLength(2);
    expect(full.meta.hasMore).toBe(true);
    expect(full.meta.nextCursor).not.toBeNull();

    const partial = buildPage(rows.slice(0, 2), 2, (r) => r.at);
    expect(partial.meta.hasMore).toBe(false);
    expect(partial.meta.nextCursor).toBeNull();
  });
});

describe('token handling', () => {
  it('hashes session tokens irreversibly and stably', () => {
    const token = 'abc123';
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toBe(token);
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('binds a CSRF token to its session secret', () => {
    expect(deriveCsrfToken('secret-a')).not.toBe(deriveCsrfToken('secret-b'));
    expect(deriveCsrfToken('secret-a')).toBe(deriveCsrfToken('secret-a'));
  });

  it('compares safely across differing lengths without throwing', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });

  it('normalizes email for lookup', () => {
    expect(normalizeEmail('  Owner@Example.COM ')).toBe('owner@example.com');
  });
});

describe('fixed clock', () => {
  it('only moves when advanced', () => {
    const clock = new FixedClock('2026-01-01T00:00:00.000Z');
    const first = clock.now();
    const second = clock.now();
    expect(first.toISOString()).toBe(second.toISOString());

    clock.advanceDays(7);
    expect(clock.now().toISOString()).toBe('2026-01-08T00:00:00.000Z');
  });
});

describe('configuration', () => {
  it('uses a __Host- prefixed secure cookie in production', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://x/y',
      APP_ORIGIN: 'https://learn.example.com',
    } as NodeJS.ProcessEnv);
    expect(config.session.cookieName).toBe('__Host-dp_session');
    expect(config.session.secure).toBe(true);
  });

  it('does not use the __Host- prefix in development, where there is no TLS', () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://x/y',
    } as NodeJS.ProcessEnv);
    expect(config.session.cookieName).toBe('dp_session');
    expect(config.session.secure).toBe(false);
  });

  it('rejects a missing database url rather than starting half-configured', () => {
    expect(() => loadConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toThrowError(
      /DATABASE_URL/,
    );
  });

  it('strips a trailing slash from the origin so comparisons match', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://x/y',
      APP_ORIGIN: 'http://localhost:5173/',
    } as NodeJS.ProcessEnv);
    expect(config.appOrigin).toBe('http://localhost:5173');
  });
});

describe('password policy', () => {
  it('requires a reasonable length', () => {
    expect(checkPasswordPolicy('short').ok).toBe(false);
    expect(checkPasswordPolicy('correct-horse-battery-staple').ok).toBe(true);
  });
});

describe('argon2 parameters', () => {
  it('keeps production cost at or above the OWASP floor', () => {
    // Tests run at a reduced work factor for speed; this asserts the constant
    // real password storage uses has not been weakened along with it.
    expect(ARGON2_PARAMS.memoryCost).toBeGreaterThanOrEqual(OWASP_ARGON2_FLOOR.memoryCost);
    expect(ARGON2_PARAMS.timeCost).toBeGreaterThanOrEqual(OWASP_ARGON2_FLOOR.timeCost);
    expect(ARGON2_PARAMS.parallelism).toBeGreaterThanOrEqual(OWASP_ARGON2_FLOOR.parallelism);
    expect(ARGON2_PARAMS.outputLen).toBeGreaterThanOrEqual(32);
  });
});
