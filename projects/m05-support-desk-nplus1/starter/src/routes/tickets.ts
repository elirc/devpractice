import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { trainingUserId } from '../identity.js';

/**
 * STARTER — M05.
 *
 * This code WORKS. Every test in `check:baseline` passes and the responses are
 * correct. That is what makes this mission different from the others: you are
 * not fixing a wrong answer, you are fixing how the answer is obtained.
 *
 * The support desk added a dashboard that lists tickets together with their
 * comment counts and latest comment. It was fine with five seeded tickets. With
 * a realistic backlog the page takes seconds and the database sits at high CPU.
 *
 * Your job: make `GET /tickets?withComments=true` issue a NUMBER OF QUERIES
 * THAT DOES NOT GROW WITH THE NUMBER OF TICKETS, while returning exactly the
 * same response body it returns today.
 *
 * Do not change the response shape. `check:baseline` pins it, and the mission
 * checks compare against a recorded snapshot of today's output.
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
      // ------------------------------------------------------------------
      // THIS IS THE MISSION.
      //
      // One query per ticket for the count, and another per ticket for the
      // latest comment. Twenty tickets on a page means forty-one round trips.
      // Each one is fast; together they are the reason the dashboard is slow.
      // ------------------------------------------------------------------
      data = [];
      for (const ticket of page) {
        const commentCount = await prisma.comment.count({ where: { ticketId: ticket.id } });
        const latest = await prisma.comment.findFirst({
          where: { ticketId: ticket.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { body: true },
        });
        data.push({
          id: ticket.id,
          title: ticket.title,
          status: ticket.status,
          customerName: ticket.customerName,
          createdAt: ticket.createdAt,
          commentCount,
          latestCommentBody: latest?.body ?? null,
        });
      }
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
