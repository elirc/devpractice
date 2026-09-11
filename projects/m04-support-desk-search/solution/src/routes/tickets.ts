import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { trainingUserId } from '../identity.js';

/**
 * REFERENCE SOLUTION for M04.
 *
 * Three ideas carry the whole mission:
 *
 * 1. SEARCH IS PART OF THE WHERE CLAUSE, NOT A POST-FILTER.
 *    Filtering rows in JavaScript after the query returns short pages: you
 *    asked the database for `limit` rows, threw some away, and now the page is
 *    smaller than requested while `hasMore` still claims there is more. The
 *    database must do the matching so `take` counts matching rows.
 *
 * 2. THE ORDER MUST BE TOTAL.
 *    Six fixture tickets share one createdAt. Ordering by createdAt alone is
 *    ambiguous, and an ambiguous order means "everything after this row" has no
 *    single answer — rows get repeated or skipped at page boundaries. Ordering
 *    by (createdAt, id) is total because id is unique, and the cursor carries
 *    BOTH columns so resuming is exact.
 *
 * 3. A CURSOR BELONGS TO THE QUERY THAT PRODUCED IT.
 *    A cursor is a position in a specific ordered result set. Hand it to a
 *    different filter and the position is meaningless. We bind the filter into
 *    the cursor and reject a cursor whose filter does not match the request,
 *    which turns a silent wrong-page bug into a clear 400.
 */

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

const createTicketSchema = z.object({
  title: z.string().trim().min(1, 'Enter a short summary of the problem.').max(120),
  body: z.string().trim().max(8000).default(''),
  customerName: z.string().trim().min(1, 'Enter the customer name.').max(120),
});

const createCommentSchema = z.object({
  body: z.string().trim().min(1, 'Enter a comment.').max(4000),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT).catch(DEFAULT_LIMIT),
  cursor: z.string().max(400).optional(),
  status: z.enum(['open', 'pending', 'closed']).optional(),
  // Trimmed, and capped so a caller cannot send a megabyte of search text.
  q: z.string().trim().max(200).optional(),
});

interface Cursor {
  createdAt: string;
  id: string;
  /** The filter this cursor was issued for. */
  filter: string;
}

/**
 * A stable fingerprint of the filters that shaped the result set. Two requests
 * with the same filters produce the same string; any change produces a
 * different one.
 */
function filterKey(q: string | undefined, status: string | undefined): string {
  return JSON.stringify({ q: (q ?? '').toLowerCase(), status: status ?? '' });
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    const result = z
      .object({ createdAt: z.string(), id: z.string(), filter: z.string() })
      .safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Case-insensitive substring match across the three columns a dispatcher would
 * actually search. `contains` is a substring match, so "printer" does not match
 * "printing" — which is what the near-miss fixtures check.
 */
function searchWhere(q: string): Prisma.TicketWhereInput {
  return {
    OR: [
      { title: { contains: q, mode: 'insensitive' } },
      { body: { contains: q, mode: 'insensitive' } },
      { customerName: { contains: q, mode: 'insensitive' } },
    ],
  };
}

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

export async function registerTicketRoutes(app: FastifyInstance): Promise<void> {
  app.post('/tickets', async (request, reply) => {
    const parsed = createTicketSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'The ticket was rejected.',
          fieldErrors: fieldErrorsOf(parsed.error),
        },
      });
    }

    const ticket = await prisma.ticket.create({
      data: { ...parsed.data, ownerId: trainingUserId(request) },
    });
    return reply.status(201).send({ data: ticket });
  });

  app.get('/tickets', async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !cursor) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Malformed cursor.' } });
    }

    // An empty q is not a search for the empty string; it means "no search".
    const q = query.q && query.q.length > 0 ? query.q : undefined;
    const key = filterKey(q, query.status);

    if (cursor && cursor.filter !== key) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message:
            'This cursor was issued for a different search. Start again from the first page when the filters change.',
        },
      });
    }

    const conditions: Prisma.TicketWhereInput[] = [];
    if (query.status) conditions.push({ status: query.status });
    if (q) conditions.push(searchWhere(q));
    if (cursor) {
      conditions.push({
        OR: [
          { createdAt: { gt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } },
        ],
      });
    }

    // AND-ing the parts keeps the search's own OR from swallowing the status
    // filter or the cursor bound — a classic way to leak non-matching rows.
    const where: Prisma.TicketWhereInput = conditions.length > 0 ? { AND: conditions } : {};

    const rows = await prisma.ticket.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    return reply.send({
      data: page,
      meta: {
        nextCursor:
          hasMore && last
            ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id, filter: key })
            : null,
        hasMore,
      },
    });
  });

  app.get<{ Params: { id: string } }>('/tickets/:id', async (request, reply) => {
    const ticket = await prisma.ticket.findUnique({ where: { id: request.params.id } });
    if (!ticket) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No such ticket.' } });
    }
    return reply.send({ data: ticket });
  });

  app.get<{ Params: { id: string } }>('/tickets/:id/comments', async (request, reply) => {
    const ticket = await prisma.ticket.findUnique({
      where: { id: request.params.id },
      select: { id: true },
    });
    if (!ticket) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No such ticket.' } });
    }
    const comments = await prisma.comment.findMany({
      where: { ticketId: request.params.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return reply.send({ data: comments });
  });

  app.post<{ Params: { id: string } }>('/tickets/:id/comments', async (request, reply) => {
    const parsed = createCommentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'The comment was rejected.',
          fieldErrors: fieldErrorsOf(parsed.error),
        },
      });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: request.params.id },
      select: { id: true },
    });
    if (!ticket) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No such ticket.' } });
    }

    const comment = await prisma.comment.create({
      data: { ticketId: ticket.id, authorId: trainingUserId(request), body: parsed.data.body },
    });
    return reply.status(201).send({ data: comment });
  });
}
