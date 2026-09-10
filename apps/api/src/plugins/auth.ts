import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Tx } from '../db/client.js';
import type { Clock } from '../lib/clock.js';
import type { OwnerContext } from '../lib/auth-context.js';
import { hashSessionToken } from '../lib/tokens.js';

/**
 * Session resolution (spec 6).
 *
 * Runs on every request. A valid, unexpired, unrevoked session attaches an
 * OwnerContext; anything else simply leaves it unset, and routes that need it
 * call requireOwner(). Expiry is enforced on BOTH the absolute lifetime and
 * the idle window.
 */

export interface AuthDeps {
  config: AppConfig;
  db: Tx;
  clock: Clock;
}

export function sessionCookieOptions(config: AppConfig, maxAgeMs?: number) {
  return {
    httpOnly: true,
    secure: config.session.secure,
    sameSite: 'lax' as const,
    // Host-only: no Domain attribute. Required by the __Host- prefix.
    path: '/',
    ...(maxAgeMs === undefined ? {} : { maxAge: Math.floor(maxAgeMs / 1000) }),
  };
}

export function setSessionCookie(
  reply: FastifyReply,
  config: AppConfig,
  token: string,
  maxAgeMs: number,
): void {
  reply.setCookie(config.session.cookieName, token, sessionCookieOptions(config, maxAgeMs));
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(config.session.cookieName, sessionCookieOptions(config));
}

/**
 * Resolve the session behind a request. Returns null for missing, unknown,
 * revoked, absolutely-expired or idle-expired sessions.
 */
export async function resolveSession(
  request: FastifyRequest,
  deps: AuthDeps,
): Promise<OwnerContext | null> {
  // Defensive: cookie parsing is a plugin, so never assume it populated.
  const raw = request.cookies?.[deps.config.session.cookieName];
  if (!raw) return null;

  const session = await deps.db.session.findUnique({
    where: { tokenHash: hashSessionToken(raw) },
    include: {
      user: {
        select: { id: true, timezone: true, activeReleaseId: true },
      },
    },
  });
  if (!session || session.revokedAt) return null;

  const now = deps.clock.now();
  if (session.expiresAt.getTime() <= now.getTime()) return null;

  const idleDeadline = session.lastSeenAt.getTime() + deps.config.session.idleMs;
  if (idleDeadline <= now.getTime()) return null;

  // Limit write amplification: touch lastSeenAt at most once per throttle window.
  if (now.getTime() - session.lastSeenAt.getTime() >= deps.config.session.lastSeenThrottleMs) {
    await deps.db.session.update({
      where: { id: session.id },
      data: { lastSeenAt: now },
    });
  }

  return {
    userId: session.userId,
    sessionId: session.id,
    csrfSecret: session.csrfSecret,
    activeReleaseId: session.user.activeReleaseId,
    timezone: session.user.timezone,
    expiresAt: session.expiresAt,
  };
}

export function registerAuthPlugin(app: FastifyInstance, deps: AuthDeps): void {
  app.addHook('onRequest', async (request) => {
    request.owner = (await resolveSession(request, deps)) ?? undefined;
  });
}
