/**
 * MISSION checks — these FAIL on a fresh checkout.
 *
 * They fail because `Idempotency-Key` is accepted and ignored, so a retry
 * places a second order and moves stock twice.
 *
 * Note what is NOT being tested: that orders work at all. They already do, and
 * `check:baseline` pins that. These tests are entirely about doing the work
 * exactly once.
 */
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { prisma, resetDatabase, testApp, onHand } from './helpers.js';

const ORDER = {
  customerName: 'Brightleaf Bakery',
  lines: [
    { productId: 'prod-ink-black', quantity: 3 },
    { productId: 'prod-paper-a4', quantity: 5 },
  ],
};

function place(
  app: ReturnType<typeof testApp>,
  key: string,
  payload: unknown = ORDER,
  user = 'user-mira',
) {
  return app.inject({
    method: 'POST',
    url: '/orders',
    headers: { 'idempotency-key': key, 'x-training-user': user },
    payload: payload as Record<string, unknown>,
  });
}

describe('M07 idempotent order submission', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a repeated submission with the same key creates ONE order', async () => {
    const app = testApp();

    const first = await place(app, 'key-alpha');
    expect(first.statusCode).toBe(201);

    const second = await place(app, 'key-alpha');
    // A replay is not a creation: 200, not 201.
    expect(second.statusCode).toBe(200);

    expect(await prisma.order.count()).toBe(1);
  });

  it('the replay returns the ORIGINAL response, not a new one', async () => {
    const app = testApp();

    const first = await place(app, 'key-beta');
    const second = await place(app, 'key-beta');

    const firstOrder = (first.json() as { data: { id: string; total: number } }).data;
    const secondOrder = (second.json() as { data: { id: string; total: number } }).data;

    expect(secondOrder.id, 'the same order id must come back').toBe(firstOrder.id);
    expect(secondOrder.total).toBe(firstOrder.total);
  });

  it('stock moves exactly once across a retry', async () => {
    const app = testApp();

    await place(app, 'key-gamma');
    await place(app, 'key-gamma');
    await place(app, 'key-gamma');

    // 40 - 3, not 40 - 9.
    expect(await onHand('prod-ink-black')).toBe(37);
    expect(await onHand('prod-paper-a4')).toBe(115);
    expect(await prisma.stockMovement.count({ where: { orderId: { not: null } } })).toBe(2);
  });

  /**
   * The case a check-then-write cannot survive. Both requests look up the key,
   * both find nothing, and both proceed. Only a uniqueness guarantee in the
   * database can decide this.
   */
  it('two CONCURRENT submissions with the same key create ONE order', async () => {
    const app = testApp();

    const [a, b] = await Promise.all([place(app, 'key-race'), place(app, 'key-race')]);

    const statuses = [a.statusCode, b.statusCode].sort();
    expect(
      await prisma.order.count(),
      `concurrent duplicates produced ${await prisma.order.count()} orders (statuses ${statuses.join(', ')})`,
    ).toBe(1);

    // Exactly one request may report a creation. The other must be a replay
    // (200) or an explicit in-progress/conflict signal — never a second 201.
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(await onHand('prod-ink-black')).toBe(37);
  });

  it('the same key with a DIFFERENT body is a conflict, not a replay', async () => {
    const app = testApp();

    const first = await place(app, 'key-delta');
    expect(first.statusCode).toBe(201);

    const different = await place(app, 'key-delta', {
      customerName: 'Someone Else Entirely',
      lines: [{ productId: 'prod-ink-colour', quantity: 1 }],
    });

    expect(different.statusCode).toBe(409);
    expect(await prisma.order.count()).toBe(1);
    // The conflicting submission must not have moved any colour stock.
    expect(await onHand('prod-ink-colour')).toBe(25);
  });

  it('keys are scoped per user: the same key from two users is two orders', async () => {
    const app = testApp();

    const mira = await place(app, 'shared-key', ORDER, 'user-mira');
    const tomas = await place(app, 'shared-key', ORDER, 'user-tomas');

    expect(mira.statusCode).toBe(201);
    expect(tomas.statusCode, "another user's key must not replay").toBe(201);
    expect(await prisma.order.count()).toBe(2);
  });

  it('a rejected submission records no receipt, so a corrected retry can succeed', async () => {
    const app = testApp();

    // Too much stock requested: this must fail.
    const failed = await place(app, 'key-epsilon', {
      customerName: 'Greedy Co',
      lines: [{ productId: 'prod-ink-black', quantity: 9999 }],
    });
    expect(failed.statusCode).toBe(409);
    expect(await prisma.order.count()).toBe(0);

    // The same key, now with a satisfiable order, must be allowed through
    // rather than replaying a failure forever.
    const corrected = await place(app, 'key-epsilon');
    expect(corrected.statusCode).toBe(201);
    expect(await prisma.order.count()).toBe(1);
  });

  it('a submission with no key still works, and is not deduplicated', async () => {
    const app = testApp();

    const first = await app.inject({ method: 'POST', url: '/orders', payload: ORDER });
    const second = await app.inject({ method: 'POST', url: '/orders', payload: ORDER });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    // Without a key there is no way to know these are the same intent.
    expect(await prisma.order.count()).toBe(2);
  });

  it('an invalid body is rejected before any receipt is written', async () => {
    const app = testApp();

    const response = await place(app, 'key-zeta', { customerName: 'No Lines Co', lines: [] });
    expect(response.statusCode).toBe(400);

    // The same key must remain usable.
    const good = await place(app, 'key-zeta');
    expect(good.statusCode).toBe(201);
  });
});
