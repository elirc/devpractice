/**
 * BASELINE checks — these MUST pass on a fresh checkout.
 *
 * M07 is a REPAIR mission, so the baseline is larger than usual: it proves the
 * whole ordering flow already works. That matters, because your fix must not
 * break any of it. If one of these fails after your change, you have traded one
 * defect for another.
 */
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { prisma, resetDatabase, testApp, onHand, countAll } from './helpers.js';

describe('environment', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('connects to the learning database', async () => {
    const rows = await prisma.$queryRaw`SELECT 1 as ok`;
    expect(rows).toBeTruthy();
  });

  it('has the idempotency table the repair will use', async () => {
    await expect(prisma.idempotencyRecord.count()).resolves.toBeTypeOf('number');
  });

  it('the database refuses two records with the same (owner, operation, key)', async () => {
    const row = {
      ownerId: 'user-mira',
      operation: 'place-order',
      key: 'fixture-key',
      requestHash: 'abc',
      response: { ok: true },
    };
    await prisma.idempotencyRecord.create({ data: row });
    await expect(prisma.idempotencyRecord.create({ data: row })).rejects.toBeTruthy();
  });

  it('serves the health route', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });
});

describe('ordering already works and must keep working', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('places an order and moves stock', async () => {
    const app = testApp();
    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: {
        customerName: 'Brightleaf Bakery',
        lines: [{ productId: 'prod-ink-black', quantity: 3 }],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(await onHand('prod-ink-black')).toBe(37);
  });

  it('captures the price at the time of the order', async () => {
    const app = testApp();
    const created = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: {
        customerName: 'Halden Legal',
        lines: [{ productId: 'prod-ink-black', quantity: 2 }],
      },
    });
    const order = (created.json() as { data: { id: string; total: number } }).data;
    expect(order.total).toBe(4900);
  });

  it('rejects an order with no lines', async () => {
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

  it('rolls the whole order back when one line cannot be satisfied', async () => {
    const app = testApp();
    const before = await countAll();

    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: {
        customerName: 'Partial Co',
        lines: [
          { productId: 'prod-ink-black', quantity: 1 },
          { productId: 'prod-ink-colour', quantity: 999 },
        ],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(await countAll()).toEqual(before);
    expect(await onHand('prod-ink-black')).toBe(40);
  });

  it('lists products with on-hand quantities', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/products' });
    expect(response.statusCode).toBe(200);
    const rows = (response.json() as { data: { id: string; onHand: number }[] }).data;
    expect(rows.find((row) => row.id === 'prod-ink-black')?.onHand).toBe(40);
  });
});
