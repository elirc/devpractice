/**
 * BASELINE checks - these MUST pass on a fresh checkout, before you write
 * anything. They prove the database, the migrations, the inventory service and
 * a single clean run of the report job all work. If one of these fails, your
 * environment or your edit is wrong; fix that before looking at the mission.
 */
import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  prisma,
  resetDatabase,
  testApp,
  onHand,
  PRODUCTS,
  OPENING_STOCK,
  enqueueJob,
  jobRow,
  linesOf,
  expectedReport,
} from './helpers.js';
import { runReportJob } from '../src/jobs/report.js';

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

  it('has the migrated tables, including the job tables', async () => {
    await expect(prisma.product.count()).resolves.toBeTypeOf('number');
    await expect(prisma.stockMovement.count()).resolves.toBeTypeOf('number');
    await expect(prisma.reportJob.count()).resolves.toBeTypeOf('number');
    await expect(prisma.reportLine.count()).resolves.toBeTypeOf('number');
  });

  it('enforces the unique index that makes a rerun detectable', async () => {
    const jobId = await enqueueJob();
    const productId = 'prod-ink-black';
    await prisma.reportLine.create({ data: { jobId, productId, onHand: 1, value: 1 } });

    // The constraint is the backstop the mission leans on. If it were missing,
    // a duplicating rerun would silently succeed and the mission checks would
    // be measuring nothing.
    await expect(
      prisma.reportLine.create({ data: { jobId, productId, onHand: 1, value: 1 } }),
    ).rejects.toThrow();
  });

  it('serves the health route', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('the inventory service still works', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('lists products with their on-hand quantity from the ledger', async () => {
    const app = testApp();
    const response = await app.inject({ method: 'GET', url: '/products' });
    expect(response.statusCode).toBe(200);

    const rows = (response.json() as { data: { id: string; onHand: number }[] }).data;
    expect(rows).toHaveLength(PRODUCTS.length);
    for (const row of rows) {
      expect(row.onHand).toBe(OPENING_STOCK[row.id]);
    }
  });

  it('places an order and moves stock atomically', async () => {
    const app = testApp();
    const before = await onHand('prod-ink-black');

    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { customerName: 'Brightleaf Bakery', lines: [{ productId: 'prod-ink-black', quantity: 3 }] },
    });
    expect(response.statusCode).toBe(201);
    expect(await onHand('prod-ink-black')).toBe(before - 3);
  });
});

describe('enqueueing a report job', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('accepts the job with 202 and runs nothing inside the request', async () => {
    const app = testApp();
    const response = await app.inject({
      method: 'POST',
      url: '/reports/jobs',
      payload: { kind: 'stock-valuation', params: { period: '2026-09' } },
    });

    expect(response.statusCode).toBe(202);
    const job = (response.json() as { data: { id: string; status: string; attempts: number } }).data;
    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(0);
    expect(await prisma.reportLine.count()).toBe(0);
  });

  it('returns 404 for a job that does not exist', async () => {
    const app = testApp();
    const response = await app.inject({
      method: 'GET',
      url: '/reports/jobs/11111111-1111-1111-1111-111111111111',
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('one clean run of the report job', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('writes one line per product, with quantities and values from the ledger', async () => {
    const jobId = await enqueueJob();
    const outcome = await runReportJob(jobId);

    expect(outcome.status).toBe('succeeded');
    expect(outcome.linesWritten).toBe(PRODUCTS.length);

    const lines = await linesOf(jobId);
    const expected = await expectedReport();
    expect(lines.map((line) => ({ productId: line.productId, onHand: line.onHand, value: line.value }))).toEqual(
      expected,
    );
  });

  it('includes a product stocked at zero rather than skipping it', async () => {
    const jobId = await enqueueJob();
    await runReportJob(jobId);

    const lines = await linesOf(jobId);
    const zero = lines.find((line) => line.productId === 'prod-label-sm');
    expect(zero, 'a product with no stock still belongs in a stock report').toBeDefined();
    expect(zero?.onHand).toBe(0);
    expect(zero?.value).toBe(0);
  });

  it('marks the job succeeded and counts the attempt', async () => {
    const jobId = await enqueueJob();
    await runReportJob(jobId);

    const job = await jobRow(jobId);
    expect(job.status).toBe('succeeded');
    expect(job.attempts).toBe(1);
    expect(job.lastError).toBeNull();
  });

  it('rejects a run against an unknown job id rather than inventing one', async () => {
    await expect(runReportJob('11111111-1111-1111-1111-111111111111')).rejects.toThrow();
  });
});
