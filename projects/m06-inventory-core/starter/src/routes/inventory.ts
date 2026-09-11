import type { FastifyInstance } from 'fastify';

/**
 * STARTER — M06.
 *
 * The database, the schema, the migrations, the seed and the server all work.
 * `check:baseline` proves it. Every endpoint below is missing.
 *
 * You are building the core of a small inventory service:
 *
 *   POST /products                 create a product
 *   GET  /products                 list products with their on-hand quantity
 *   POST /products/:id/movements   record stock in or out
 *   POST /orders                   create an order with lines, and place it
 *   GET  /orders/:id               fetch an order with its lines and total
 *
 * The interesting part is not the CRUD. It is the INVARIANTS — the statements
 * that must be true no matter what a caller sends or how two callers interleave:
 *
 *   1. A SKU is unique across products.
 *   2. A movement's delta is a non-zero integer.
 *   3. On-hand stock is never negative.
 *   4. An order has at least one line, and every line has quantity >= 1.
 *   5. A line must reference a product that exists.
 *   6. Placing an order records the stock movements for its lines, and either
 *      ALL of that happens or NONE of it does.
 *
 * Read the README for the exact acceptance criteria and status codes. Note that
 * on-hand stock is the SUM OF MOVEMENTS, not a column you decrement — think
 * about why that choice makes invariant 3 harder to state and safer to hold.
 */
export async function registerInventoryRoutes(app: FastifyInstance): Promise<void> {
  app.all('/products', async (_request, reply) =>
    reply.status(501).send({
      error: { code: 'NOT_IMPLEMENTED', message: 'Mission M06: implement the product endpoints.' },
    }),
  );

  app.all('/orders', async (_request, reply) =>
    reply.status(501).send({
      error: { code: 'NOT_IMPLEMENTED', message: 'Mission M06: implement the order endpoints.' },
    }),
  );
}
