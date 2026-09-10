import type { FastifyReply } from 'fastify';
import { HTTP_STATUS_BY_CODE, type ErrorCode } from '@devpractice/contracts';

export class ApiProblem extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiProblem';
  }
}

export const problem = {
  badRequest: (m = 'Malformed request.', f?: Record<string, string[]>) =>
    new ApiProblem('BAD_REQUEST', m, f),
  unauthenticated: (m = 'Sign in to continue.') => new ApiProblem('UNAUTHENTICATED', m),
  forbidden: (m = 'Not available.') => new ApiProblem('FORBIDDEN', m),
  notFound: (m = 'Not found.') => new ApiProblem('NOT_FOUND', m),
  revisionConflict: (m: string, extra: Record<string, unknown>) =>
    new ApiProblem('REVISION_CONFLICT', m, undefined, extra),
  idempotencyConflict: (m = 'This event id was already used with a different request body.') =>
    new ApiProblem('IDEMPOTENCY_CONFLICT', m),
  releaseConflict: (m: string, extra?: Record<string, unknown>) =>
    new ApiProblem('RELEASE_CONFLICT', m, undefined, extra),
  tooLarge: (m = 'Payload too large.') => new ApiProblem('PAYLOAD_TOO_LARGE', m),
  contentInvalid: (m: string, f?: Record<string, string[]>) =>
    new ApiProblem('CONTENT_INVALID', m, f),
  rateLimited: (m = 'Too many attempts. Try again later.') => new ApiProblem('RATE_LIMITED', m),
};

export function sendProblem(reply: FastifyReply, err: ApiProblem, requestId: string): FastifyReply {
  return reply.status(HTTP_STATUS_BY_CODE[err.code]).send({
    error: {
      code: err.code,
      message: err.message,
      ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}),
      ...(err.extra ?? {}),
      requestId,
    },
  });
}

export function ok<T>(reply: FastifyReply, data: T, meta?: unknown): FastifyReply {
  return reply.send(meta === undefined ? { data } : { data, meta });
}
