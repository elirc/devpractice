import { problem } from './errors.js';

/**
 * Opaque cursor pagination over a stable sort key (spec 9.1).
 *
 * The sort key is always (timestamp, id) so ties cannot make a row appear on
 * two pages or vanish between them.
 */

export interface CursorPayload {
  ts: string;
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof (raw as CursorPayload).ts !== 'string' ||
      typeof (raw as CursorPayload).id !== 'string'
    ) {
      throw new Error('shape');
    }
    const payload = raw as CursorPayload;
    if (Number.isNaN(Date.parse(payload.ts))) throw new Error('ts');
    return payload;
  } catch {
    throw problem.badRequest('Invalid pagination cursor.');
  }
}

export interface Page<T> {
  items: T[];
  meta: { nextCursor: string | null; hasMore: boolean };
}

/**
 * Take one more row than requested to decide `hasMore` without a count query.
 */
export function buildPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  timestampOf: (row: T) => Date,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    meta: {
      hasMore,
      nextCursor:
        hasMore && last ? encodeCursor({ ts: timestampOf(last).toISOString(), id: last.id }) : null,
    },
  };
}
