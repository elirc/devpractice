import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { ApiProblem, sendProblem } from '../lib/errors.js';
import { fieldErrorsOf } from '../lib/validate.js';

/**
 * Single exit point for failures (spec 9.1).
 *
 * The owner gets a useful message; diagnostic detail goes to the server log
 * against a requestId. Stack traces and database text never reach a response.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  // The 404 handler is set once in app.ts, because whether an unmatched GET
  // falls through to the SPA depends on the frontend build being present.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiProblem) {
      // Expected, already-shaped failures are not server errors.
      request.log.debug({ code: error.code, route: request.routeOptions?.url }, 'api problem');
      sendProblem(reply, error, request.id);
      return;
    }

    if (error instanceof ZodError) {
      sendProblem(
        reply,
        new ApiProblem('BAD_REQUEST', 'Malformed request.', fieldErrorsOf(error)),
        request.id,
      );
      return;
    }

    // Fastify's own body-limit / parse failures carry a statusCode.
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 413) {
      sendProblem(reply, new ApiProblem('PAYLOAD_TOO_LARGE', 'Payload too large.'), request.id);
      return;
    }
    if (statusCode === 400) {
      sendProblem(reply, new ApiProblem('BAD_REQUEST', 'Malformed request.'), request.id);
      return;
    }

    request.log.error(
      { err: error, route: request.routeOptions?.url, requestId: request.id },
      'unhandled error',
    );
    sendProblem(
      reply,
      new ApiProblem('INTERNAL_ERROR', 'Something went wrong. The failure was logged.'),
      request.id,
    );
  });
}
