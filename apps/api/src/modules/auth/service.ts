import type { OwnerSummary } from '@devpractice/contracts';
import type { PrismaClient, User } from '@prisma/client';
import type { AppConfig } from '../../config.js';
import type { Clock } from '../../lib/clock.js';
import { problem } from '../../lib/errors.js';
import {
  deriveCsrfToken,
  generateCsrfSecret,
  generateSessionToken,
  hashSessionToken,
} from '../../lib/tokens.js';

/** Theme is stored as text; narrow it back to the contract union on read. */
export function narrowTheme(value: string): OwnerSummary['theme'] {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function ownerSummary(user: User, csrfSecret: string, sessionExpiresAt: Date): OwnerSummary {
  return {
    id: user.id,
    email: user.displayEmail,
    timezone: user.timezone,
    theme: narrowTheme(user.theme),
    preferencesRevision: user.preferencesRevision,
    activeReleaseId: user.activeReleaseId,
    sessionExpiresAt: sessionExpiresAt.toISOString(),
    csrfToken: deriveCsrfToken(csrfSecret),
  };
}

/**
 * Login throttling (spec 6): a configurable number of FAILED attempts per
 * (account, source address) window. Successes are recorded too, for the audit
 * trail, but only failures count toward the limit — and the window slides, so
 * the owner is never permanently locked out.
 */
export async function assertLoginAllowed(
  db: PrismaClient,
  config: AppConfig,
  clock: Clock,
  normalizedEmail: string,
  sourceAddress: string,
): Promise<void> {
  const since = new Date(clock.now().getTime() - config.login.windowMs);
  const failures = await db.loginAttempt.count({
    where: { normalizedEmail, sourceAddress, succeeded: false, createdAt: { gte: since } },
  });
  if (failures >= config.login.maxAttempts) {
    throw problem.rateLimited('Too many sign-in attempts. Try again in a few minutes.');
  }
}

export async function recordLoginAttempt(
  db: PrismaClient,
  clock: Clock,
  normalizedEmail: string,
  sourceAddress: string,
  succeeded: boolean,
): Promise<void> {
  await db.loginAttempt.create({
    data: { normalizedEmail, sourceAddress, succeeded, createdAt: clock.now() },
  });

  // Proving the password clears the failure streak for this account and source.
  // The throttle exists to slow guessing, not to punish the owner for typos:
  // without this, a handful of mistakes keeps blocking sign-in for the rest of
  // the window even once the correct password is known.
  if (succeeded) {
    await db.loginAttempt.deleteMany({
      where: { normalizedEmail, sourceAddress, succeeded: false },
    });
  }
}

export interface CreatedSession {
  token: string;
  sessionId: string;
  csrfSecret: string;
  expiresAt: Date;
}

/**
 * Create a session. The raw token is returned exactly once — only its hash is
 * persisted, so the database never holds a usable credential.
 */
export async function createSession(
  db: PrismaClient,
  config: AppConfig,
  clock: Clock,
  userId: string,
): Promise<CreatedSession> {
  const token = generateSessionToken();
  const csrfSecret = generateCsrfSecret();
  const now = clock.now();
  const expiresAt = new Date(now.getTime() + config.session.absoluteMs);

  const session = await db.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      csrfSecret,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
    },
  });

  return { token, sessionId: session.id, csrfSecret, expiresAt };
}

export async function revokeSession(
  db: PrismaClient,
  clock: Clock,
  sessionId: string,
): Promise<void> {
  await db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: clock.now() },
  });
}

export async function revokeAllSessions(
  db: PrismaClient,
  clock: Clock,
  userId: string,
): Promise<number> {
  const result = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: clock.now() },
  });
  return result.count;
}

/** Housekeeping for the maintenance command (spec 8.3). */
export async function deleteExpiredSessions(db: PrismaClient, clock: Clock): Promise<number> {
  const result = await db.session.deleteMany({
    where: { expiresAt: { lt: clock.now() } },
  });
  return result.count;
}
