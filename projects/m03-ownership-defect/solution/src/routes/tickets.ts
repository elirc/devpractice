import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { trainingUserId } from '../identity.js';

/**
 * REFERENCE SOLUTION for M03.
 *
 * The defect was that only the LIST endpoint scoped its query by owner. Every
 * by-id endpoint fetched the row first and then either forgot to check the
 * owner, or checked it and announced the owner's name in the refusal.
 *
 * The fix has three parts:
 *
 *  1. `findOwnedTicket` makes ownership part of the QUERY, not a check after
 *     the fact. A query that cannot return a foreign row cannot leak one, and
 *     there is no window between reading and checking.
 *  2. Every inaccessible resource returns 404, matching the documented policy.
 *     403 would confirm that the id exists.
 *  3. Refusals carry no data from the record. The previous 403 named the owner
 *     and the customer — the exact information the check existed to protect.
 *
 * Note what this is NOT: a framework rewrite, a permissions library, or an
 * interface change. The boundary belongs in the data access path.
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
  cursor: z.string().max(200).optional(),
  status: z.enum(['open', 'pending', 'closed']).optional(),
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

/**
 * Fetch a ticket ONLY if it belongs to the caller.
 *
 * Ownership is part of the where clause, so a foreign ticket is simply not
 * found. Callers cannot forget a follow-up check that does not exist.
 */
async function findOwnedTicket<T extends Prisma.TicketSelect>(
  id: string,
  ownerId: string,
  select: T,
) {
  return prisma.ticket.findFirst({ where: { id, ownerId }, select });
}

/** One shape for "you cannot have this", whatever the reason. */
function notFound(reply: Parameters<Parameters<FastifyInstance['get']>[1]>[1]) {
  return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No such ticket.' } });
}

export async function registerTicketRoutes(app: FastifyInstance): Promise<void> {
  app.post('/tickets', async (request, reply) => {
    const parsed = createTicketSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'The ticket was rejected.', fieldErrors: fieldErrorsOf(parsed.error) } });
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
      ownerId: trainingUserId(request),
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

    return reply.send({
      data: page,
      meta: {
        nextCursor:
          hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
        hasMore,
      },
    });
  });

  app.get<{ Params: { id: string } }>('/tickets/:id', async (request, reply) => {
    const ticket = await prisma.ticket.findFirst({
      where: { id: request.params.id, ownerId: trainingUserId(request) },
    });
    // Foreign and non-existent are deliberately indistinguishable.
    if (!ticket) return notFound(reply);
    return reply.send({ data: ticket });
  });

  app.patch<{ Params: { id: string } }>('/tickets/:id', async (request, reply) => {
    const parsed = z
      .object({ status: z.enum(['open', 'pending', 'closed']) })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'Invalid status.', fieldErrors: fieldErrorsOf(parsed.error) } });
    }

    const existing = await findOwnedTicket(request.params.id, trainingUserId(request), { id: true });
    // No 403, and no detail from the record: the refusal itself must not leak.
    if (!existing) return notFound(reply);

    const ticket = await prisma.ticket.update({
      where: { id: existing.id },
      data: { status: parsed.data.status },
    });
    return reply.send({ data: ticket });
  });

  app.get<{ Params: { id: string } }>('/tickets/:id/comments', async (request, reply) => {
    const ticket = await findOwnedTicket(request.params.id, trainingUserId(request), { id: true });
    if (!ticket) return notFound(reply);
    const comments = await prisma.comment.findMany({
      where: { ticketId: request.params.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return reply.send({ data: comments });
  });

  app.post<{ Params: { id: string } }>('/tickets/:id/comments', async (request, reply) => {
    const parsed = createCommentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'The comment was rejected.', fieldErrors: fieldErrorsOf(parsed.error) } });
    }

    const ticket = await findOwnedTicket(request.params.id, trainingUserId(request), { id: true });
    if (!ticket) return notFound(reply);

    const comment = await prisma.comment.create({
      data: { ticketId: ticket.id, authorId: trainingUserId(request), body: parsed.data.body },
    });
    return reply.status(201).send({ data: comment });
  });
}
