import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

/**
 * Enqueue and inspect report jobs. This file is NOT the mission — it is already
 * complete and `check:baseline` pins it. The work is in src/jobs/report.ts.
 *
 * Note that enqueueing only writes a row. Nothing runs inside the request: a
 * report over the whole catalogue has no business holding an HTTP connection
 * open, and a caller that disconnects must not cancel work that was accepted.
 */

/**
 * Params are restricted to JSON scalars rather than `unknown`. A Json column
 * will accept anything that serialises, which is exactly why the boundary is
 * worth narrowing here: a job parameter is a period or a flag, not an arbitrary
 * object graph.
 */
const createJobSchema = z.object({
  kind: z.string().trim().min(1).max(80).default('stock-valuation'),
  params: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  maxAttempts: z.number().int().min(1).max(10).optional(),
});

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/reports/jobs', async (request, reply) => {
    const parsed = createJobSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: 'The job was rejected.' },
      });
    }

    const job = await prisma.reportJob.create({
      data: {
        kind: parsed.data.kind,
        params: parsed.data.params,
        ...(parsed.data.maxAttempts ? { maxAttempts: parsed.data.maxAttempts } : {}),
      },
    });
    // 202, not 201: the job is accepted, and has not run.
    return reply.status(202).send({ data: job });
  });

  app.get<{ Params: { id: string } }>('/reports/jobs/:id', async (request, reply) => {
    const job = await prisma.reportJob.findUnique({
      where: { id: request.params.id },
      include: { lines: { orderBy: { productId: 'asc' } } },
    });
    if (!job) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No such report job.' } });
    }
    return reply.send({ data: job });
  });
}
