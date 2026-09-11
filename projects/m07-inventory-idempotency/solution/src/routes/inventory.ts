import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma, MovementReason } from '@prisma/client';
import { prisma } from '../db.js';
import { trainingUserId } from '../identity.js';

/**
 * REFERENCE SOLUTION for M07.
 *
 * The rule that makes this work: LET THE DATABASE DECIDE, NOT THE CLOCK.
 *
 * The tempting shape is "look up the key; if absent, do the work". That is a
 * check-then-act, and two concurrent retries both pass the check before either
 * writes. No amount of ordering the statements fixes it, because the gap is
 * between two round trips.
 *
 * Instead, the receipt is INSERTED inside the same transaction that places the
 * order, and (ownerId, operation, key) is unique. Two concurrent submissions
 * therefore race to insert, exactly one wins, and the loser gets a unique
 * violation it can recognise and turn into a replay. The database arbitrates,
 * so correctness does not depend on which request happened to be faster.
 *
 * Writing the receipt inside the transaction also gives the other rules for
 * free:
 *   - The work and the record of it commit together, so a crash between them is
 *     impossible.
 *   - A FAILED submission rolls back its receipt with everything else, which is
 *     what lets a corrected retry through instead of replaying a failure.
 *
 * The request hash covers the mismatch case: same key, different body means the
 * client reused a key for a different intent. Replaying the first response
 * would silently discard the second order, so it is a 409.
 *
 * Scope is (ownerId, operation, key): two users may pick "order-1" on the same
 * day, and the same key on a different operation is a different intent.
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


/* --------------------------- idempotency support -------------------------- */

const IDEMPOTENCY_HEADER = 'idempotency-key';
const PLACE_ORDER = 'place-order';

/**
 * A stable fingerprint of the request. Key order must not matter: a client that
 * serialises the same intent with its fields in a different order has not
 * changed its mind.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

function requestHash(body: unknown): string {
  return createHash('sha256').update(canonical(body)).digest('hex');
}

function idempotencyKeyOf(request: { headers: Record<string, unknown> }): string | null {
  const raw = request.headers[IDEMPOTENCY_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

class KeyReused extends Error {
  constructor() {
    super('This Idempotency-Key was already used with a different request body.');
    this.name = 'KeyReused';
  }
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
    // Validation happens BEFORE any receipt exists, so a malformed body never
    // consumes the key.
    if (!parsed.success) return reply.status(400).send(badRequest(parsed.error));

    const ownerId = trainingUserId(request);
    const key = idempotencyKeyOf(request as unknown as { headers: Record<string, unknown> });
    const hash = requestHash(parsed.data);

    /** Replay a stored receipt, or reject it if the body has changed. */
    const replay = (record: { requestHash: string; response: unknown }) => {
      if (record.requestHash !== hash) throw new KeyReused();
      // 200, not 201: this request created nothing.
      return reply.status(200).send(record.response as object);
    };

    // Fast path for an obvious retry. This is an optimisation, NOT the
    // guarantee — the unique constraint below is what actually decides.
    if (key) {
      const existing = await prisma.idempotencyRecord.findUnique({
        where: { ownerId_operation_key: { ownerId, operation: PLACE_ORDER, key } },
      });
      if (existing) {
        try {
          return replay(existing);
        } catch (error) {
          if (error instanceof KeyReused) {
            return reply
              .status(409)
              .send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: error.message } });
          }
          throw error;
        }
      }
    }

    try {
      const payload = await prisma.$transaction(async (tx) => {
        const productIds = parsed.data.lines.map((line) => line.productId);
        const products = await tx.product.findMany({ where: { id: { in: productIds } } });
        const byId = new Map(products.map((product) => [product.id, product]));

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
            throw new StockShortfall(product.id, current, line.quantity);
          }

          await tx.orderLine.create({
            data: {
              orderId: created.id,
              productId: product.id,
              quantity: line.quantity,
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

        const order = await tx.order.findUniqueOrThrow({
          where: { id: created.id },
          include: { lines: true },
        });
        const body = { data: withTotal(order) };

        // The receipt is written INSIDE the transaction. If anything above
        // failed, this rolls back with it and the key stays usable; if two
        // retries race, the unique constraint rejects the loser here.
        if (key) {
          await tx.idempotencyRecord.create({
            data: { ownerId, operation: PLACE_ORDER, key, requestHash: hash, response: body },
          });
        }

        return body;
      });

      return reply.status(201).send(payload);
    } catch (error) {
      if (error instanceof UnknownProduct) {
        return reply.status(404).send({ error: error.toPayload() });
      }
      if (error instanceof StockShortfall) {
        return reply.status(409).send({ error: error.toPayload() });
      }
      if (error instanceof KeyReused) {
        return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: error.message } });
      }
      // P2002 here means a concurrent request won the race and already wrote
      // the receipt. Our transaction rolled back, so no duplicate order exists;
      // read the winner's response and replay it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && key) {
        const winner = await prisma.idempotencyRecord.findUnique({
          where: { ownerId_operation_key: { ownerId, operation: PLACE_ORDER, key } },
        });
        if (winner) {
          if (winner.requestHash !== hash) {
            return reply.status(409).send({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: 'This Idempotency-Key was already used with a different request body.' } });
          }
          return reply.status(200).send(winner.response as object);
        }
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
