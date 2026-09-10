import type { FastifyInstance } from 'fastify';

/**
 * Health endpoints (spec 9.2). Production responses carry minimal status and
 * never expose configuration, versions of dependencies, or connection details.
 */
export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.deps;

  app.get('/health/live', async (_request, reply) => reply.send({ data: { status: 'ok' } }));

  app.get('/health/ready', async (_request, reply) => {
    try {
      await db.$queryRaw`SELECT 1`;
      return reply.send({ data: { status: 'ready' } });
    } catch (error) {
      app.log.error({ err: error }, 'readiness check failed');
      return reply.status(503).send({ data: { status: 'unavailable' } });
    }
  });
}
