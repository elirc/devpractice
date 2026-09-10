import type { PrismaClient } from '@prisma/client';
import { getDeps } from '../../lib/deps.js';
import type { Clock } from '../../lib/clock.js';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { Tx } from '../../db/client.js';
import { problem } from '../../lib/errors.js';
import type { XpAwardRequest } from '@devpractice/learning-core';

/**
 * Helpers shared by the learning-domain modules. Route schemas are
 * application-authored static zod schemas; imported course data is never
 * compiled into a route validator (spec 5.3).
 */

export function parseBody<T extends z.ZodTypeAny>(schema: T, request: FastifyRequest): z.infer<T> {
  const result = schema.safeParse(request.body);
  if (!result.success) throw problem.badRequest('Invalid request body.', fieldErrors(result.error));
  return result.data;
}

export function parseParams<T extends z.ZodTypeAny>(
  schema: T,
  request: FastifyRequest,
): z.infer<T> {
  const result = schema.safeParse(request.params);
  if (!result.success) throw problem.badRequest('Invalid path.', fieldErrors(result.error));
  return result.data;
}

export function parseQuery<T extends z.ZodTypeAny>(schema: T, request: FastifyRequest): z.infer<T> {
  const result = schema.safeParse(request.query);
  if (!result.success) throw problem.badRequest('Invalid query.', fieldErrors(result.error));
  return result.data;
}

export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/**
 * Award XP at most once per key. The unique (userId, awardKey) constraint is
 * the real guarantee; this returns how much was actually granted so a replay
 * reports zero rather than inflating the total.
 */
export async function grantXp(
  tx: Tx,
  userId: string,
  award: XpAwardRequest,
): Promise<number> {
  const created = await tx.xpAward.createMany({
    data: [{ userId, awardKey: award.awardKey, amount: award.amount, reason: award.reason }],
    skipDuplicates: true,
  });
  return created.count > 0 ? award.amount : 0;
}

export async function recordActivity(
  tx: Tx,
  userId: string,
  kind: string,
  contentItemId: string | null,
  relatedRecordId: string | null,
  detail?: Record<string, unknown>,
): Promise<void> {
  await tx.activityEvent.create({
    data: {
      userId,
      kind,
      contentItemId,
      relatedRecordId,
      detail: detail === undefined ? undefined : (detail as object),
    },
  });
}

/** Server time is the only ordering authority; never trust a client clock. */
export function serverNow(): Date {
  return new Date();
}

/**
 * The injected Prisma client. Route modules must use this rather than the
 * global singleton so integration tests can run against a disposable database
 * with a controlled clock.
 */
export function db(): PrismaClient {
  return getDeps().db;
}

export function clock(): Clock {
  return getDeps().clock;
}

/**
 * Interactive-transaction budget for learning mutations.
 *
 * Prisma defaults to 5s, which this project outgrew in two ways: publishing a
 * release writes a few hundred rows, and even a small attempt transaction can
 * exceed 5s on a contended machine (checkpoints here have been measured in the
 * tens of seconds). A transaction that gives up half-written is worse than one
 * that takes longer, so the budget is explicit rather than inherited.
 */
export const TX_OPTIONS = { timeout: 30_000, maxWait: 15_000 } as const;
