/**
 * BASELINE checks — these MUST pass on a fresh checkout, before you write
 * anything. They prove the database, the migrations, the seed and the server
 * scaffold work. If one fails, fix your environment before starting.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { prisma, resetDatabase, testApp, onHand } from './helpers.js';

describe('environment', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('connects to the learning database', async () => {
    const rows = await prisma.$queryRaw`SELECT 1 as ok`;
    expect(rows).toBeTruthy();
  });

  it('has every migrated table', async () => {
    await expect(prisma.product.count()).resolves.toBeTypeOf('number');
    await expect(prisma.stockMovement.count()).resolves.toBeTypeOf('number');
    await expect(prisma.order.count()).resolves.toBeTypeOf('number');
    await expect(prisma.orderLine.count()).resolves.toBeTypeOf('number');
  });

  it('serves the health route', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('the database enforces the constraints your code will rely on', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects a duplicate SKU at the database level', async () => {
    await expect(
      prisma.product.create({
        data: { sku: 'INK-BLK-01', name: 'Duplicate', unitPrice: 100 },
      }),
    ).rejects.toBeTruthy();
  });

  it('rejects a movement for a product that does not exist', async () => {
    await expect(
      prisma.stockMovement.create({
        data: { productId: 'no-such-product', delta: 1, reason: 'received' },
      }),
    ).rejects.toBeTruthy();
  });

  it('rejects two lines for the same product on one order', async () => {
    const order = await prisma.order.create({
      data: { customerName: 'Fixture Co', ownerId: 'user-mira' },
    });
    await prisma.orderLine.create({
      data: { orderId: order.id, productId: 'prod-ink-black', quantity: 1, unitPrice: 2450 },
    });
    await expect(
      prisma.orderLine.create({
        data: { orderId: order.id, productId: 'prod-ink-black', quantity: 2, unitPrice: 2450 },
      }),
    ).rejects.toBeTruthy();
  });

  it('computes on-hand stock from the movement ledger', async () => {
    expect(await onHand('prod-ink-black')).toBe(40);
    expect(await onHand('prod-label-sm')).toBe(0);
  });
});
