import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { trainingUserId } from '../identity.js';

/**
 * Support desk API — the version you have been asked to repair.
 *
 * Everything here runs. The list endpoint, validation, pagination and comments
 * all work, and the baseline checks pass. Something is nonetheless wrong, and
 * the security checks describe it. Read them, reproduce the problem, then fix
 * it properly rather than hiding it in the interface.
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
    const ticket = await prisma.ticket.findUnique({
      where: { id: request.params.id },
      include: { owner: true },
    });
    if (!ticket) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No such ticket.' } });
    }
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

    const existing = await prisma.ticket.findUnique({
      where: { id: request.params.id },
      include: { owner: true },
    });
    if (!existing) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No such ticket.' } });
    }
    if (existing.ownerId !== trainingUserId(request)) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `This ticket belongs to ${existing.owner.displayName} (${existing.customerName}).`,
        },
      });
    }

    const ticket = await prisma.ticket.update({
      where: { id: existing.id },
      data: { status: parsed.data.status },
    });
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
      return reply
        .status(400)
        .send({ error: { code: 'BAD_REQUEST', message: 'The comment was rejected.', fieldErrors: fieldErrorsOf(parsed.error) } });
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
