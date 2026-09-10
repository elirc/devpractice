import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Session and CSRF token material (spec 6).
 *
 * The session token is an opaque random string. Only its SHA-256 hash is
 * stored, so a database read never yields a usable credential. The CSRF token
 * is derived from a per-session secret via HMAC, binding it to that session:
 * a token minted for one session cannot authorise a request on another.
 */

const SESSION_TOKEN_BYTES = 32;
const CSRF_SECRET_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateCsrfSecret(): string {
  return randomBytes(CSRF_SECRET_BYTES).toString('base64url');
}

/**
 * Derive the CSRF token a client must echo back.
 * Deterministic for a given secret, so GET /auth/me can re-issue it without
 * storing another row.
 */
export function deriveCsrfToken(secret: string): string {
  return createHmac('sha256', secret).update('devpractice-csrf-v1').digest('base64url');
}

/** Constant-time comparison that tolerates differing lengths. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so the failure path costs the same shape.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Pre-session CSRF state for the login form. There is no session yet, so the
 * secret rides in a short-lived host-only cookie and the token is its HMAC.
 *
 * It satisfies the __Host- prefix rules (Secure, Path=/, no Domain) in
 * production, so the browser refuses it from a subdomain.
 */
const PRE_SESSION_COOKIE_BASE = 'dp_csrf';
export const PRE_SESSION_TTL_MS = 30 * 60 * 1000;

export function preSessionCookieName(isProduction: boolean): string {
  return isProduction ? `__Host-${PRE_SESSION_COOKIE_BASE}` : PRE_SESSION_COOKIE_BASE;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
