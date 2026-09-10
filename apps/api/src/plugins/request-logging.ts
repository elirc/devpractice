import type { FastifyInstance } from 'fastify';

/**
 * Structured request logs (spec 15.2).
 *
 * Logged: requestId, method, route, status, duration, and a non-sensitive
 * owner reference. Never logged: passwords, cookies, CSRF tokens, note bodies,
 * learner source, or full request payloads.
 */

declare module 'fastify' {
  interface FastifyRequest {
    startTimeNs?: bigint;
  }
}

export function registerRequestLogging(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    request.startTimeNs = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (request, reply) => {
    const durationMs = request.startTimeNs
      ? Number(process.hrtime.bigint() - request.startTimeNs) / 1_000_000
      : undefined;

    request.log.info(
      {
        requestId: request.id,
        method: request.method,
        route: request.routeOptions?.url ?? request.url.split('?')[0],
        status: reply.statusCode,
        durationMs: durationMs === undefined ? undefined : Math.round(durationMs * 100) / 100,
        // Owner reference only — never the email address.
        owner: request.owner?.userId ?? null,
      },
      'request',
    );
  });
}

/** Pino redaction paths applied at logger construction. */
export const LOG_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'password',
  'body.password',
  'body.source',
  'body.body',
  'body.csrfToken',
];
