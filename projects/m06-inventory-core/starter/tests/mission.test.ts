/**
 * MISSION checks — these FAIL on a fresh checkout, because no endpoint exists.
 *
 * They are grouped by the invariant each one defends, because that is what the
 * mission is really about: not "does the route return 201", but "is this
 * statement still true after any sequence of calls a client can make".
 */
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { prisma, resetDatabase, testApp, onHand, countAll } from './helpers.js';

interface Envelope<T> {
  data: T;
}

describe('M06 inventory core', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /* ------------------------------ products ------------------------------ */

  it('creates a product', async () => {
    const app = testApp();
    const response = await app.inject({
      method: 'POST',
      url: '/products',
      payload: { sku: 'NEW-SKU-01', name: 'Stapler', unitPrice: 1200 },
    });
    expect(response.statusCode).toBe(201);

    const body = response.json() as Envelope<{ id: string; sku: string }>;
    expect(body.data.sku).toBe('NEW-SKU-01');
    expect(await prisma.product.count()).toBe(5);
  });

  it('invariant 1: a duplicate SKU is rejected and writes nothing', async () => {
    const app = testApp();
    const before = await countAll();

    const response = await app.inject({
      method: 'POST',
      url: '/products',
      // Same SKU as the seeded black ink cartridge.
      payload: { sku: 'INK-BLK-01', name: 'Impostor cartridge', unitPrice: 999 },
    });

    expect(response.statusCode).toBe(409);
    expect(await countAll()).toEqual(before);
  });

  it('rejects a non-positive or non-integer price without writing', async () => {
    const app = testApp();
    const before = await countAll();

    for (const unitPrice of [0, -5, 12.5]) {
      const response = await app.inject({
        method: 'POST',
        url: '/products',
        payload: { sku: `BAD-${unitPrice}`, name: 'Bad price', unitPrice },
      });
      expect(response.statusCode, `unitPrice ${unitPrice} must be rejected`).toBe(400);
    }
    expect(await countAll()).toEqual(before);
  });

  it('lists products with their on-hand quantity from the ledger', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/products' });
    expect(response.statusCode).toBe(200);

    const rows = (response.json() as Envelope<{ id: string; onHand: number }[]>).data;
    const black = rows.find((row) => row.id === 'prod-ink-black');
    const labels = rows.find((row) => row.id === 'prod-label-sm');

    expect(black?.onHand).toBe(40);
    // A product with no movements at all must report 0, not be omitted.
    expect(labels?.onHand).toBe(0);
    expect(rows).toHaveLength(4);
  });

  /* ------------------------------ movements ----------------------------- */

  it('records stock in and stock out', async () => {
    const app = testApp();

    const received = await app.inject({
      method: 'POST',
      url: '/products/prod-ink-black/movements',
      payload: { delta: 10, reason: 'received' },
    });
    expect(received.statusCode).toBe(201);
    expect(await onHand('prod-ink-black')).toBe(50);

    const sold = await app.inject({
      method: 'POST',
      url: '/products/prod-ink-black/movements',
      payload: { delta: -4, reason: 'sold' },
    });
    expect(sold.statusCode).toBe(201);
    expect(await onHand('prod-ink-black')).toBe(46);
  });

  it('invariant 2: a zero or fractional delta is rejected', async () => {
    const app = testApp();
    for (const delta of [0, 2.5]) {
      const response = await app.inject({
        method: 'POST',
        url: '/products/prod-ink-black/movements',
        payload: { delta, reason: 'adjustment' },
      });
      expect(response.statusCode, `delta ${delta} must be rejected`).toBe(400);
    }
    expect(await onHand('prod-ink-black')).toBe(40);
  });

  it('invariant 3: stock can never go negative', async () => {
    const app = testApp();
    const response = await app.inject({
      method: 'POST',
      url: '/products/prod-ink-black/movements',
      payload: { delta: -41, reason: 'sold' },
    });

    expect(response.statusCode).toBe(409);
    expect(await onHand('prod-ink-black')).toBe(40);
    // The rejected movement must not have been written.
    expect(await prisma.stockMovement.count({ where: { productId: 'prod-ink-black' } })).toBe(1);
  });

  it('a movement against an unknown product is a 404', async () => {
    const app = testApp();
    const response = await app.inject({
      method: 'POST',
      url: '/products/no-such-product/movements',
      payload: { delta: 5, reason: 'received' },
    });
    expect(response.statusCode).toBe(404);
    // A missing ROUTE also returns 404, so a bare status check would pass on
    // the untouched starter. Require the application's own error envelope.
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  /* -------------------------------- orders ------------------------------- */

  it('places an order and moves stock for every line, atomically', async () => {
    const app = testApp();
    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: {
        customerName: 'Brightleaf Bakery',
        lines: [
          { productId: 'prod-ink-black', quantity: 3 },
          { productId: 'prod-paper-a4', quantity: 10 },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    const order = (response.json() as Envelope<{ id: string; status: string; total: number }>).data;
    expect(order.status).toBe('placed');
    // 3 * 2450 + 10 * 640 = 13750
    expect(order.total).toBe(13750);

    expect(await onHand('prod-ink-black')).toBe(37);
    expect(await onHand('prod-paper-a4')).toBe(110);

    // The movements must be linked to the order that caused them.
    const linked = await prisma.stockMovement.count({ where: { orderId: order.id } });
    expect(linked).toBe(2);
  });

  it('invariant 4: an order with no lines is rejected', async () => {
    const app = testApp();
    const before = await countAll();

    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { customerName: 'Empty Co', lines: [] },
    });

    expect(response.statusCode).toBe(400);
    expect(await countAll()).toEqual(before);
  });

  it('invariant 4: a line quantity below 1 is rejected', async () => {
    const app = testApp();
    const before = await countAll();

    for (const quantity of [0, -2, 1.5]) {
      const response = await app.inject({
        method: 'POST',
        url: '/orders',
        payload: {
          customerName: 'Bad Quantity Co',
          lines: [{ productId: 'prod-ink-black', quantity }],
        },
      });
      expect(response.statusCode, `quantity ${quantity} must be rejected`).toBe(400);
    }
    expect(await countAll()).toEqual(before);
  });

  it('invariant 5: a line referencing an unknown product is rejected', async () => {
    const app = testApp();
    const before = await countAll();

    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: {
        customerName: 'Ghost Product Co',
        lines: [{ productId: 'no-such-product', quantity: 1 }],
      },
    });

    expect(response.statusCode).toBe(404);
    expect(await countAll()).toEqual(before);
  });

  /**
   * The invariant that separates a working implementation from a careful one.
   * The first line is satisfiable and the second is not, so a route that writes
   * as it goes will leave the first movement behind after the failure.
   */
  it('invariant 6: a partially satisfiable order writes NOTHING', async () => {
    const app = testApp();
    const before = await countAll();

    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: {
        customerName: 'Partial Co',
        lines: [
          { productId: 'prod-ink-black', quantity: 1 },
          // Only 25 colour cartridges exist.
          { productId: 'prod-ink-colour', quantity: 999 },
        ],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(await countAll(), 'no order, no lines, no movements').toEqual(before);
    expect(await onHand('prod-ink-black'), 'the satisfiable line must be rolled back too').toBe(40);
    expect(await onHand('prod-ink-colour')).toBe(25);
  });

  it('fetches an order with its lines and captured prices', async () => {
    const app = testApp();
    const created = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: {
        customerName: 'Halden Legal',
        lines: [{ productId: 'prod-ink-black', quantity: 2 }],
      },
    });
    const orderId = (created.json() as Envelope<{ id: string }>).data.id;

    // Reprice the product AFTER the order was placed.
    await prisma.product.update({ where: { id: 'prod-ink-black' }, data: { unitPrice: 9999 } });

    const response = await app.inject({ method: 'GET', url: `/orders/${orderId}` });
    expect(response.statusCode).toBe(200);

    const order = (response.json() as Envelope<{
      total: number;
      lines: { productId: string; quantity: number; unitPrice: number }[];
    }>).data;

    expect(order.lines).toHaveLength(1);
    // The captured price, not today's price.
    expect(order.lines[0]?.unitPrice).toBe(2450);
    expect(order.total).toBe(4900);
  });

  it('returns 404 for an unknown order', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/orders/no-such-order' });
    expect(response.statusCode).toBe(404);
    // As above: discriminate against Fastify's default route-not-found body.
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
