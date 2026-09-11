import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, MovementReason } from '@prisma/client';
import { prisma } from '../db.js';
import { trainingUserId } from '../identity.js';

/**
 * REFERENCE SOLUTION for M06.
 *
 * The theme is that an invariant is only as strong as the place it is enforced.
 * There are three places, and they are not interchangeable:
 *
 *  - THE SCHEMA holds what must never be true of stored data: a unique SKU, a
 *    line that must point at a real product, one line per product per order.
 *    These survive a bug in this file, which is why they belong there.
 *
 *  - THE TRANSACTION holds what must be true ACROSS several rows: an order and
 *    its lines and its stock movements are one fact, so they commit together or
 *    not at all. Nothing outside a transaction can express that.
 *
 *  - THE ROUTE holds what makes a good error: a 409 saying which product was
 *    short, rather than a constraint violation leaking out as a 500.
 *
 * The stock rule deserves its own note. On-hand quantity is the SUM OF
 * MOVEMENTS, not a column. That makes "never negative" harder to state — there
 * is no single value to add a CHECK to — but it is what gives every change a
 * reason and an audit trail, and it means two concurrent writers append rather
 * than overwrite a total. We read the sum and re-check it INSIDE the
 * transaction so a concurrent order cannot slip between the check and the write.
 */

const createProductSchema = z.object({
  sku: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  // Money in minor units: an integer, and a product you cannot pay for is not
  // a product.
  unitPrice: z.number().int('Price must be a whole number of pence.').positive(),
});

const createMovementSchema = z.object({
  delta: z
    .number()
    .int('A movement must be a whole number of units.')
    .refine((value) => value !== 0, 'A movement of zero is not an event.'),
  reason: z.nativeEnum(MovementReason),
});

const createOrderSchema = z.object({
  customerName: z.string().trim().min(1).max(200),
  lines: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        quantity: z.number().int('Quantity must be a whole number.').min(1, 'Quantity must be at least 1.'),
      }),
    )
    .min(1, 'An order needs at least one line.'),
});

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'body';
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

function badRequest(error: z.ZodError) {
  return {
    error: {
      code: 'BAD_REQUEST',
      message: 'The request was rejected.',
      fieldErrors: fieldErrorsOf(error),
    },
  };
}

/** On-hand quantity for one product, read from the ledger. */
async function onHandIn(tx: Prisma.TransactionClient, productId: string): Promise<number> {
  const result = await tx.stockMovement.aggregate({
    where: { productId },
    _sum: { delta: true },
  });
  return result._sum.delta ?? 0;
}

export async function registerInventoryRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------ products ------------------------------ */

  app.post('/products', async (request, reply) => {
    const parsed = createProductSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send(badRequest(parsed.error));

    try {
      const product = await prisma.product.create({ data: parsed.data });
      return reply.status(201).send({ data: product });
    } catch (error) {
      // P2002 is the unique-constraint violation. Catching it here turns a
      // database error into a meaningful 409 — and, crucially, we let the
      // DATABASE decide, rather than checking first and racing between the
      // check and the insert.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.status(409).send({
          error: { code: 'SKU_TAKEN', message: 'A product with that SKU already exists.' },
        });
      }
      throw error;
    }
  });

  app.get('/products', async (_request, reply) => {
    const products = await prisma.product.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

    // One grouped query for the whole page rather than one per product.
    const sums = await prisma.stockMovement.groupBy({
      by: ['productId'],
      _sum: { delta: true },
    });
    const onHandByProduct = new Map(sums.map((row) => [row.productId, row._sum.delta ?? 0]));

    return reply.send({
      data: products.map((product) => ({
        ...product,
        // A product with no movements has no row in the aggregate at all. It
        // must still appear, at zero.
        onHand: onHandByProduct.get(product.id) ?? 0,
      })),
    });
  });

  app.post<{ Params: { id: string } }>('/products/:id/movements', async (request, reply) => {
    const parsed = createMovementSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send(badRequest(parsed.error));

    const product = await prisma.product.findUnique({
      where: { id: request.params.id },
      select: { id: true },
    });
    if (!product) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No such product.' } });
    }

    try {
      const movement = await prisma.$transaction(async (tx) => {
        // Read and check INSIDE the transaction: outside it, a concurrent
        // movement could land between the read and the write and drive the
        // total negative.
        const current = await onHandIn(tx, product.id);
        if (current + parsed.data.delta < 0) {
          throw new StockShortfall(product.id, current, -parsed.data.delta);
        }
        return tx.stockMovement.create({
          data: { productId: product.id, delta: parsed.data.delta, reason: parsed.data.reason },
        });
      });
      return reply.status(201).send({ data: movement });
    } catch (error) {
      if (error instanceof StockShortfall) {
        return reply.status(409).send({ error: error.toPayload() });
      }
      throw error;
    }
  });

  /* -------------------------------- orders ------------------------------- */

  app.post('/orders', async (request, reply) => {
    const parsed = createOrderSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send(badRequest(parsed.error));

    const ownerId = trainingUserId(request);

    try {
      const order = await prisma.$transaction(async (tx) => {
        const productIds = parsed.data.lines.map((line) => line.productId);
        const products = await tx.product.findMany({ where: { id: { in: productIds } } });
        const byId = new Map(products.map((product) => [product.id, product]));

        // Every referenced product must exist BEFORE anything is written.
        const missing = productIds.filter((id) => !byId.has(id));
        if (missing.length > 0) throw new UnknownProduct(missing);

        const created = await tx.order.create({
          data: {
            customerName: parsed.data.customerName,
            ownerId,
            status: 'placed',
            placedAt: new Date(),
          },
        });

        for (const line of parsed.data.lines) {
          const product = byId.get(line.productId);
          if (!product) throw new UnknownProduct([line.productId]);

          const current = await onHandIn(tx, product.id);
          if (current - line.quantity < 0) {
            // Throwing rolls the whole transaction back, including the order
            // row and any earlier line's movement. That is invariant 6.
            throw new StockShortfall(product.id, current, line.quantity);
          }

          await tx.orderLine.create({
            data: {
              orderId: created.id,
              productId: product.id,
              quantity: line.quantity,
              // Capture the price now, so a later reprice cannot change a
              // placed order's total.
              unitPrice: product.unitPrice,
            },
          });

          await tx.stockMovement.create({
            data: {
              productId: product.id,
              delta: -line.quantity,
              reason: MovementReason.sold,
              orderId: created.id,
            },
          });
        }

        return tx.order.findUniqueOrThrow({
          where: { id: created.id },
          include: { lines: true },
        });
      });

      return reply.status(201).send({ data: withTotal(order) });
    } catch (error) {
      if (error instanceof UnknownProduct) {
        return reply.status(404).send({ error: error.toPayload() });
      }
      if (error instanceof StockShortfall) {
        return reply.status(409).send({ error: error.toPayload() });
      }
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>('/orders/:id', async (request, reply) => {
    const order = await prisma.order.findUnique({
      where: { id: request.params.id },
      include: { lines: true },
    });
    if (!order) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'No such order.' } });
    }
    return reply.send({ data: withTotal(order) });
  });
}

/** The total is derived from the captured line prices, never recomputed from
 *  today's product prices. */
function withTotal<T extends { lines: { quantity: number; unitPrice: number }[] }>(order: T) {
  const total = order.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  return { ...order, total };
}

class StockShortfall extends Error {
  constructor(
    readonly productId: string,
    readonly available: number,
    readonly requested: number,
  ) {
    super(`Insufficient stock for ${productId}`);
    this.name = 'StockShortfall';
  }

  toPayload() {
    return {
      code: 'INSUFFICIENT_STOCK',
      message: `Only ${this.available} in stock; ${this.requested} requested.`,
      productId: this.productId,
      available: this.available,
      requested: this.requested,
    };
  }
}

class UnknownProduct extends Error {
  constructor(readonly productIds: string[]) {
    super(`Unknown product(s): ${productIds.join(', ')}`);
    this.name = 'UnknownProduct';
  }

  toPayload() {
    return {
      code: 'NOT_FOUND',
      message: 'One or more lines reference a product that does not exist.',
      productIds: this.productIds,
    };
  }
}
