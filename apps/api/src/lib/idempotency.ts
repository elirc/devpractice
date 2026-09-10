import { createHash } from 'node:crypto';
import type { Tx } from '../db/client.js';
import { problem } from './errors.js';

/**
 * Idempotent mutation support (spec 9.1).
 *
 * A repeated clientEventId with the SAME canonical body returns the original
 * stored response. The same id with different content is IDEMPOTENCY_CONFLICT.
 * The receipt and the domain changes are written in ONE transaction, so a
 * failed mutation never leaves a success receipt behind.
 */

/** Stable stringify: object key order must not change the request hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function requestHash(operation: string, body: unknown): string {
  return createHash('sha256').update(`${operation}\n${canonicalJson(body)}`).digest('hex');
}

export interface IdempotencyLookup<T> {
  replayed: boolean;
  response?: T;
}

/**
 * Check for an existing receipt BEFORE doing work.
 * Returns the stored response on replay; throws on a hash mismatch.
 */
export async function findReceipt<T>(
  tx: Tx,
  userId: string,
  clientEventId: string,
  operation: string,
  body: unknown,
): Promise<IdempotencyLookup<T>> {
  const existing = await tx.mutationReceipt.findUnique({
    where: { userId_clientEventId: { userId, clientEventId } },
  });
  if (!existing) return { replayed: false };
  if (existing.requestHash !== requestHash(operation, body)) {
    throw problem.idempotencyConflict();
  }
  return { replayed: true, response: existing.response as T };
}

/** Write the receipt inside the same transaction as the domain change. */
export async function storeReceipt(
  tx: Tx,
  userId: string,
  clientEventId: string,
  operation: string,
  body: unknown,
  response: unknown,
): Promise<void> {
  await tx.mutationReceipt.create({
    data: {
      userId,
      clientEventId,
      operation,
      requestHash: requestHash(operation, body),
      response: response as object,
    },
  });
}
