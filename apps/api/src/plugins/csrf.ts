import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import { problem } from '../lib/errors.js';
import { deriveCsrfToken, safeEqual } from '../lib/tokens.js';

/**
 * CSRF defence (spec 6).
 *
 * SameSite=Lax is defence in depth, not the control. Every authenticated
 * state-changing request must additionally carry:
 *   - an Origin (or Referer) header matching APP_ORIGIN, and
 *   - a CSRF token derived from THIS session's secret.
 *
 * Login has no session yet, so it uses a pre-session secret issued by
 * GET /auth/csrf and held in its own short-lived host-only cookie.
 */

// The canonical name lives in @devpractice/contracts so the client and server
// cannot drift apart. Re-exported here for existing callers.
export { CSRF_HEADER } from '@devpractice/contracts';
import { CSRF_HEADER } from '@devpractice/contracts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Paths that perform their own CSRF check because no session exists yet. */
const SELF_CHECKED_PATHS = new Set(['/api/v1/auth/login']);

function requestOrigin(request: FastifyRequest): string | null {
  const origin = request.headers.origin;
  if (typeof origin === 'string' && origin.length > 0) return origin.replace(/\/$/, '');

  // Some browsers omit Origin on same-origin navigations; fall back to Referer.
  const referer = request.headers.referer;
  if (typeof referer === 'string' && referer.length > 0) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }
  return null;
}

export function assertOriginAllowed(request: FastifyRequest, config: AppConfig): void {
  const origin = requestOrigin(request);
  if (origin === null) {
    // A same-origin fetch from our own app always sends one of the two headers.
    throw problem.forbidden('Missing request origin.');
  }
  if (origin !== config.appOrigin) {
    throw problem.forbidden('Request origin is not allowed.');
  }
}

export function assertCsrfToken(request: FastifyRequest, secret: string): void {
  const header = request.headers[CSRF_HEADER];
  const supplied = Array.isArray(header) ? header[0] : header;
  if (typeof supplied !== 'string' || supplied.length === 0) {
    throw problem.forbidden('Missing CSRF token.');
  }
  if (!safeEqual(supplied, deriveCsrfToken(secret))) {
    throw problem.forbidden('Invalid CSRF token.');
  }
}

export function registerCsrfPlugin(app: FastifyInstance, config: AppConfig): void {
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;

    const url = request.url.split('?')[0] ?? request.url;
    if (SELF_CHECKED_PATHS.has(url)) return;

    // Unauthenticated mutations are rejected by requireOwner anyway; checking
    // the origin first keeps a cross-site probe from reaching route logic.
    assertOriginAllowed(request, config);

    if (request.owner) {
      assertCsrfToken(request, request.owner.csrfSecret);
    }
  });
}
