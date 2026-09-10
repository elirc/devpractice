import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loginBodySchema, type OwnerSummary } from '@devpractice/contracts';
import { requireOwner } from '../../lib/auth-context.js';
import { ok, problem } from '../../lib/errors.js';
import { parseOrThrow } from '../../lib/validate.js';
import {
  PRE_SESSION_TTL_MS,
  deriveCsrfToken,
  generateCsrfSecret,
  normalizeEmail,
  preSessionCookieName,
  safeEqual,
} from '../../lib/tokens.js';
import { dummyHash, verifyPassword } from '../../lib/password.js';
import { assertOriginAllowed } from '../../plugins/csrf.js';
import { clearSessionCookie, setSessionCookie, sessionCookieOptions } from '../../plugins/auth.js';
import {
  assertLoginAllowed,
  createSession,
  ownerSummary,
  recordLoginAttempt,
  revokeAllSessions,
  revokeSession,
} from './service.js';

const revokeAllBodySchema = z.object({ password: z.string().min(1).max(1024) });

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const { config, db, clock } = app.deps;
  const preSessionCookie = preSessionCookieName(config.isProduction);

  /**
   * Establish pre-session CSRF state for the sign-in form. The secret lives in
   * its own short-lived host-only cookie; the returned token is its HMAC.
   */
  app.get('/auth/csrf', async (request, reply) => {
    const secret = generateCsrfSecret();
    reply.setCookie(preSessionCookie, secret, sessionCookieOptions(config, PRE_SESSION_TTL_MS));
    return ok(reply, { csrfToken: deriveCsrfToken(secret) });
  });

  app.post('/auth/login', async (request, reply) => {
    // No session exists yet, so this route performs its own CSRF check.
    assertOriginAllowed(request, config);

    const body = parseOrThrow(loginBodySchema, request.body);
    const preSecret = request.cookies[preSessionCookie];
    if (!preSecret || !safeEqual(body.csrfToken, deriveCsrfToken(preSecret))) {
      throw problem.forbidden('Invalid or expired sign-in token. Reload the page and try again.');
    }

    const normalizedEmail = normalizeEmail(body.email);
    const sourceAddress = request.ip;

    await assertLoginAllowed(db, config, clock, normalizedEmail, sourceAddress);

    const user = await db.user.findUnique({ where: { normalizedEmail } });

    // Always run a verification so a missing account and a wrong password cost
    // the same, and never say which one it was.
    const passwordOk = user
      ? await verifyPassword(user.passwordHash, body.password)
      : await verifyPassword(await dummyHash(), body.password);

    if (!user || !passwordOk) {
      await recordLoginAttempt(db, clock, normalizedEmail, sourceAddress, false);
      throw problem.unauthenticated('Email or password is incorrect.');
    }

    const session = await createSession(db, config, clock, user.id);
    await recordLoginAttempt(db, clock, normalizedEmail, sourceAddress, true);

    setSessionCookie(reply, config, session.token, config.session.absoluteMs);
    reply.clearCookie(preSessionCookie, sessionCookieOptions(config));

    const summary: OwnerSummary = ownerSummary(user, session.csrfSecret, session.expiresAt);
    return ok(reply, summary);
  });

  app.get('/auth/me', async (request, reply) => {
    const owner = requireOwner(request);
    const user = await db.user.findUnique({ where: { id: owner.userId } });
    if (!user) throw problem.unauthenticated();
    return ok(reply, ownerSummary(user, owner.csrfSecret, owner.expiresAt));
  });

  app.post('/auth/logout', async (request, reply) => {
    // Tolerate an already-expired session: signing out must always succeed.
    if (request.owner) {
      await revokeSession(db, clock, request.owner.sessionId);
    }
    clearSessionCookie(reply, config);
    return ok(reply, { signedOut: true });
  });

  /**
   * Revoking every session is a security action, so it re-authenticates with
   * the current password rather than trusting the existing cookie alone.
   */
  app.post('/auth/revoke-all', async (request, reply) => {
    const owner = requireOwner(request);
    const body = parseOrThrow(revokeAllBodySchema, request.body);

    const user = await db.user.findUnique({ where: { id: owner.userId } });
    if (!user) throw problem.unauthenticated();

    if (!(await verifyPassword(user.passwordHash, body.password))) {
      throw problem.unauthenticated('Email or password is incorrect.');
    }

    const revoked = await revokeAllSessions(db, clock, owner.userId);
    clearSessionCookie(reply, config);
    return ok(reply, { revokedSessions: revoked });
  });
}
