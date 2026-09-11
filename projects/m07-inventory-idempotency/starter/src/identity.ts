import type { FastifyRequest } from 'fastify';

/**
 * TRAINING SCAFFOLDING — not authentication.
 *
 * The caller names itself in a header. There is no credential and nothing is
 * verified. Never model a real system on this.
 */
export const TRAINING_USER_HEADER = 'x-training-user';
export const DEFAULT_TRAINING_USER = 'user-mira';

export function trainingUserId(request: FastifyRequest): string {
  const raw = request.headers[TRAINING_USER_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : DEFAULT_TRAINING_USER;
}
