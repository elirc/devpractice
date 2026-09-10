import type { FastifyRequest } from 'fastify';
import { problem } from './errors.js';

/**
 * Authenticated owner context attached by the auth plugin.
 * Every data route resolves the owner through requireOwner(), never from
 * client-supplied ids — even though public signup is disabled (spec 6).
 */
export interface OwnerContext {
  userId: string;
  sessionId: string;
  csrfSecret: string;
  activeReleaseId: string | null;
  timezone: string;
  expiresAt: Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    owner?: OwnerContext;
  }
}

export function requireOwner(request: FastifyRequest): OwnerContext {
  if (!request.owner) throw problem.unauthenticated();
  return request.owner;
}

/**
 * Ownership assertion for any record carrying a userId.
 * Returns 404 rather than 403 for records belonging to another user so the
 * API does not confirm that a foreign id exists.
 */
export function assertOwned<T extends { userId: string }>(
  record: T | null,
  owner: OwnerContext,
): T {
  if (!record || record.userId !== owner.userId) throw problem.notFound();
  return record;
}
