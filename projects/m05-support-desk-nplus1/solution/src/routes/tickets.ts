import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { trainingUserId } from '../identity.js';

/**
 * REFERENCE SOLUTION for M05.
 *
 * The starter was not wrong, it was chatty: for every ticket on the page it
 * asked the database two more questions. Twenty tickets meant forty-one round
 * trips. Each was sub-millisecond; the latency was in the count of them.
 *
 * The fix is the standard one for N+1: stop asking per row. Fetch the page,
 * then answer the whole page's comment questions in ONE query keyed by the ids
 * you already have, and stitch the results together in memory.
 *
 * Two details that are easy to get wrong, and that the mission checks pin:
 *
 *  - A ticket with NO comments must still appear, with a count of 0. A join or
 *    a groupBy only returns rows that have something to group, so tickets with
 *    no comments are simply absent from that result. You have to default them
 *    back in rather than assume every id comes back.
 *
 *  - "Latest comment" needs a deterministic definition. Ordering by createdAt
 *    alone is ambiguous when two comments share a timestamp, so the tiebreaker
 *    on id is part of the correctness, not a detail.
 *
 * Why not `include: { comments: true }`? It would work and it would be one
 * query, but it drags every comment body over the wire to compute a count and
 * pick one row. On a busy ticket that is a lot of data to throw away. The
 * groupBy plus a targeted latest-comment query keeps the transferred data
 * proportional to the page, not to the comment history.
 */

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

const createTicketSchema = z.object({
  title: z.string().trim().min(1, 'Enter a short summary of the problem.').max(120),
  body: z.string().trim().max(8000).default(''),
  customerName: z.string().trim().min(1, 'Enter the customer name.').max(120),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT).catch(DEFAULT_LIMIT),
  cursor: z.string().max(400).optional(),
  status: z.enum(['open', 'pending', 'closed']).optional(),
  withComments: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((value) => value === 'true'),
});

interface Cursor {
  createdAt: string;
  id: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    const result = z.object({ createdAt: z.string(), id: z.string() }).safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

export interface TicketSummary {
  id: string;
  title: string;
  status: string;
  customerName: string;
  createdAt: Date;
  commentCount?: number;
  latestCommentBody?: string | null;
}

/**
 * Comment counts and latest bodies for a whole page, in two queries total,
 * regardless of how many tickets are on the page.
 */
async function commentSummaries(
  ticketIds: string[],
): Promise<Map<string, { commentCount: number; latestCommentBody: string | null }>> {
  const summaries = new Map<string, { commentCount: number; latestCommentBody: string | null }>();

  // Every ticket starts at zero. Tickets with no comments never come back from
  // the aggregate below, and defaulting here is what keeps them in the page.
  for (const id of ticketIds) {
    summaries.set(id, { commentCount: 0, latestCommentBody: null });
  }
  if (ticketIds.length === 0) return summaries;

  // Query 1: counts for the whole page.
  const grouped = await prisma.comment.groupBy({
    by: ['ticketId'],
    where: { ticketId: { in: ticketIds } },
    _count: { _all: true },
  });
  for (const row of grouped) {
    const entry = summaries.get(row.ticketId);
    if (entry) entry.commentCount = row._count._all;
  }

  // Query 2: the latest comment per ticket, chosen in the database with a
  // window function. DISTINCT ON is PostgreSQL's direct way to say "one row per
  // ticket, the first by this ordering", and the (createdAt DESC, id DESC)
  // ordering makes "latest" deterministic when timestamps tie.
  const latest = await prisma.$queryRaw<{ ticketId: string; body: string }[]>`
    SELECT DISTINCT ON ("ticketId") "ticketId", "body"
    FROM "Comment"
    WHERE "ticketId" IN (${Prisma.join(ticketIds)})
    ORDER BY "ticketId", "createdAt" DESC, "id" DESC
  `;
  for (const row of latest) {
    const entry = summaries.get(row.ticketId);
    if (entry) entry.latestCommentBody = row.body;
  }

  return summaries;
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

    const where: Prisma.TicketWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { gt: new Date(cursor.createdAt) } },
              { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } },
            ],
          }
        : {}),
    };

    const rows = await prisma.ticket.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    let data: TicketSummary[];

    if (query.withComments) {
      // Two queries for the whole page, not two per ticket.
      const summaries = await commentSummaries(page.map((ticket) => ticket.id));
      data = page.map((ticket) => {
        const summary = summaries.get(ticket.id) ?? { commentCount: 0, latestCommentBody: null };
        return {
          id: ticket.id,
          title: ticket.title,
          status: ticket.status,
          customerName: ticket.customerName,
          createdAt: ticket.createdAt,
          commentCount: summary.commentCount,
          latestCommentBody: summary.latestCommentBody,
        };
      });
    } else {
      data = page.map((ticket) => ({
        id: ticket.id,
        title: ticket.title,
        status: ticket.status,
        customerName: ticket.customerName,
        createdAt: ticket.createdAt,
      }));
    }

    return reply.send({
      data,
      meta: {
        nextCursor:
          hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
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
}
