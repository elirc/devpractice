import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Client, TEST_ORIGIN, buildTestApp, createOwner } from '../helpers/app.js';
import { createTestClient, ensureMigrated, resetDatabase } from '../helpers/db.js';
import { FixedClock } from '../../src/lib/clock.js';
import { hashSessionToken } from '../../src/lib/tokens.js';

let db: PrismaClient;

beforeAll(async () => {
  ensureMigrated();
  db = createTestClient();
});

beforeEach(async () => {
  await resetDatabase(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe('authentication and session handling (spec 6)', () => {
  it('signs in with the CSRF handshake and returns an owner summary', async () => {
    const { app } = await buildTestApp(db);
    const owner = await createOwner(db, 'owner@example.com');
    const client = new Client(app);

    const response = await client.login(owner.email, owner.password);

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { email: string; csrfToken: string } };
    expect(body.data.email).toBe('owner@example.com');
    expect(body.data.csrfToken).toBeTruthy();
    await app.close();
  });

  it('stores only a hash of the session token, never the token itself', async () => {
    const { app } = await buildTestApp(db);
    const owner = await createOwner(db, 'owner@example.com');

    // Sign in exactly once and keep that login's cookie: a second login would
    // mint a different token and compare two unrelated sessions.
    const cookieValue = await extractSessionCookie(app, owner.email, owner.password);

    const sessions = await db.session.findMany();
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;

    // The stored value must be a hash of the cookie, not the cookie itself.
    expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.tokenHash).toBe(hashSessionToken(cookieValue));
    expect(session.tokenHash).not.toBe(cookieValue);
    await app.close();
  });

  it('rejects a wrong password and an unknown account with the same generic message', async () => {
    const { app } = await buildTestApp(db);
    const owner = await createOwner(db, 'owner@example.com');
    const client = new Client(app);

    const wrongPassword = await client.login(owner.email, 'not-the-password');
    const unknownAccount = await new Client(app).login('nobody@example.com', 'whatever-password');

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownAccount.statusCode).toBe(401);
    const a = (wrongPassword.json() as { error: { message: string } }).error.message;
    const b = (unknownAccount.json() as { error: { message: string } }).error.message;
    expect(a).toBe(b);
    await app.close();
  });

  it('refuses a login without valid pre-session CSRF state', async () => {
    const { app } = await buildTestApp(db);
    const owner = await createOwner(db, 'owner@example.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
      payload: { email: owner.email, password: owner.password, csrfToken: 'forged' },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('refuses a cross-site login attempt by origin', async () => {
    const { app } = await buildTestApp(db);
    const owner = await createOwner(db, 'owner@example.com');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: { email: owner.email, password: owner.password, csrfToken: 'x' },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('rejects an authenticated mutation that omits the session CSRF token', async () => {
    const { app } = await buildTestApp(db);
    const owner = await createOwner(db, 'owner@example.com');
    const client = new Client(app);
    await client.login(owner.email, owner.password);

    // Same cookie, but no x-csrf-token header: SameSite is not the control.
    const sessionCookie = await extractSessionCookie(app, owner.email, owner.password);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/notes',
      headers: {
        origin: TEST_ORIGIN,
        cookie: `dp_session=${sessionCookie}`,
        'content-type': 'application/json',
      },
      payload: { clientEventId: globalThis.crypto.randomUUID(), title: 'x', body: 'y' },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('throttles repeated failed sign-ins and recovers after the window passes', async () => {
    const clock = new FixedClock();
    const { app } = await buildTestApp(db, clock);
    const owner = await createOwner(db, 'owner@example.com');

    for (let i = 0; i < 5; i += 1) {
      const attempt = await new Client(app).login(owner.email, 'wrong-password');
      expect(attempt.statusCode).toBe(401);
    }

    const blocked = await new Client(app).login(owner.email, owner.password);
    expect(blocked.statusCode).toBe(429);

    // The window slides: this is throttling, not a permanent lockout.
    clock.advanceMs(16 * 60 * 1000);
    const recovered = await new Client(app).login(owner.email, owner.password);
    expect(recovered.statusCode).toBe(200);
    await app.close();
  });

  it('treats an absolutely expired session as signed out', async () => {
    const clock = new FixedClock();
    const { app } = await buildTestApp(db, clock);
    const owner = await createOwner(db, 'owner@example.com');
    const client = new Client(app);
    await client.login(owner.email, owner.password);

    expect((await client.request('GET', '/api/v1/auth/me')).statusCode).toBe(200);

    clock.advanceDays(31);
    expect((await client.request('GET', '/api/v1/auth/me')).statusCode).toBe(401);
    await app.close();
  });

  it('treats an idle session beyond the idle window as signed out', async () => {
    const clock = new FixedClock();
    const { app } = await buildTestApp(db, clock);
    const owner = await createOwner(db, 'owner@example.com');
    const client = new Client(app);
    await client.login(owner.email, owner.password);

    clock.advanceDays(8);
    expect((await client.request('GET', '/api/v1/auth/me')).statusCode).toBe(401);
    await app.close();
  });

  it('revokes every session after a password reset via revoke-all', async () => {
    const { app } = await buildTestApp(db);
    const owner = await createOwner(db, 'owner@example.com');
    const laptop = new Client(app);
    const phone = new Client(app);
    await laptop.login(owner.email, owner.password);
    await phone.login(owner.email, owner.password);

    const response = await laptop.request('POST', '/api/v1/auth/revoke-all', {
      password: owner.password,
    });
    expect(response.statusCode).toBe(200);

    expect((await phone.request('GET', '/api/v1/auth/me')).statusCode).toBe(401);
    await app.close();
  });

  it('refuses revoke-all when the current password is wrong', async () => {
    const { app } = await buildTestApp(db);
    const owner = await createOwner(db, 'owner@example.com');
    const client = new Client(app);
    await client.login(owner.email, owner.password);

    const response = await client.request('POST', '/api/v1/auth/revoke-all', {
      password: 'not-the-password',
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

/** Pull the raw session cookie value out of a fresh login. */
async function extractSessionCookie(
  app: Awaited<ReturnType<typeof buildTestApp>>['app'],
  email: string,
  password: string,
): Promise<string> {
  const csrf = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/csrf',
    headers: { origin: TEST_ORIGIN },
  });
  const csrfCookie = (csrf.cookies as { name: string; value: string }[]).find(
    (c) => c.name === 'dp_csrf',
  );
  const token = (csrf.json() as { data: { csrfToken: string } }).data.csrfToken;

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: {
      origin: TEST_ORIGIN,
      cookie: `dp_csrf=${csrfCookie?.value ?? ''}`,
      'content-type': 'application/json',
    },
    payload: { email, password, csrfToken: token },
  });

  const sessionCookie = (login.cookies as { name: string; value: string }[]).find(
    (c) => c.name === 'dp_session',
  );
  return sessionCookie?.value ?? '';
}
