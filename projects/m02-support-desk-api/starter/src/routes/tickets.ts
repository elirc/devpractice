import type { FastifyInstance } from 'fastify';

/**
 * STARTER — this is the assignment.
 *
 * The database, the schema, the seed and the server all work. What is missing
 * is every ticket endpoint. `check:baseline` passes; `check:mission` does not.
 *
 * Implement, using the acceptance criteria in the README:
 *   POST   /tickets
 *   GET    /tickets                  (cursor pagination, total ordering)
 *   GET    /tickets/:id
 *   GET    /tickets/:id/comments
 *   POST   /tickets/:id/comments
 *
 * Remember that TypeScript cannot validate a JSON body that arrived over the
 * network. Validate at runtime.
 */
export async function registerTicketRoutes(app: FastifyInstance): Promise<void> {
  app.all('/tickets', async (_request, reply) =>
    reply.status(501).send({ error: { code: 'NOT_IMPLEMENTED', message: 'Mission M02: implement the ticket endpoints.' } }),
  );
}
