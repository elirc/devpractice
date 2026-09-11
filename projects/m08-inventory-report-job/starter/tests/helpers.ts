import { PrismaClient, MovementReason } from '@prisma/client';
import { buildApp } from '../src/app.js';

/**
 * Integration tests run against a REAL PostgreSQL database. The invariants this
 * mission is about — uniqueness, foreign keys, and all-or-nothing writes — are
 * enforced by the database, so a mock would prove nothing.
 */
const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL (or DATABASE_URL) before running tests.');

export const prisma = new PrismaClient({ datasources: { db: { url } } });

export function testApp() {
  return buildApp();
}

export const USERS = [
  { id: 'user-mira', displayName: 'Mira (stock controller)' },
  { id: 'user-tomas', displayName: 'Tomas (stock controller)' },
];

export const PRODUCTS = [
  { id: 'prod-ink-black', sku: 'INK-BLK-01', name: 'Black ink cartridge', unitPrice: 2450 },
  { id: 'prod-ink-colour', sku: 'INK-COL-01', name: 'Colour ink cartridge', unitPrice: 3180 },
  { id: 'prod-paper-a4', sku: 'PAP-A4-500', name: 'A4 paper, 500 sheets', unitPrice: 640 },
  // Deliberately stocked at zero, so "you cannot sell what you do not have" is
  // reachable without first draining another product.
  { id: 'prod-label-sm', sku: 'LBL-SM-1K', name: 'Small labels, 1000', unitPrice: 890 },
];

export const OPENING_STOCK: Record<string, number> = {
  'prod-ink-black': 40,
  'prod-ink-colour': 25,
  'prod-paper-a4': 120,
  'prod-label-sm': 0,
};

export async function resetDatabase(): Promise<void> {
  // ReportLine before ReportJob, and both before the movements they read, so
  // no delete trips a foreign key.
  await prisma.reportLine.deleteMany();
  await prisma.reportJob.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.orderLine.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.trainingUser.deleteMany();

  await prisma.trainingUser.createMany({ data: USERS });
  await prisma.product.createMany({ data: PRODUCTS });

  const movements = Object.entries(OPENING_STOCK)
    .filter(([, delta]) => delta !== 0)
    .map(([productId, delta], index) => ({
      id: `fix-open-${index}`,
      productId,
      delta,
      reason: MovementReason.received,
      createdAt: new Date('2026-09-01T08:00:00.000Z'),
    }));
  await prisma.stockMovement.createMany({ data: movements });
}

/**
 * On-hand quantity computed independently of the route under test, straight
 * from the ledger. If a test asked the API for the quantity it was checking,
 * it would only prove the API agrees with itself.
 */
export async function onHand(productId: string): Promise<number> {
  const result = await prisma.stockMovement.aggregate({
    where: { productId },
    _sum: { delta: true },
  });
  return result._sum.delta ?? 0;
}

export async function countAll(): Promise<{
  products: number;
  orders: number;
  lines: number;
  movements: number;
}> {
  return {
    products: await prisma.product.count(),
    orders: await prisma.order.count(),
    lines: await prisma.orderLine.count(),
    movements: await prisma.stockMovement.count(),
  };
}


/* ---------------------------- report job helpers --------------------------- */

/** Enqueue a job directly, the way POST /reports/jobs does. */
export async function enqueueJob(
  overrides: { kind?: string; maxAttempts?: number; runAfter?: Date } = {},
): Promise<string> {
  const job = await prisma.reportJob.create({
    data: {
      kind: overrides.kind ?? 'stock-valuation',
      params: { period: '2026-09' },
      ...(overrides.maxAttempts ? { maxAttempts: overrides.maxAttempts } : {}),
      ...(overrides.runAfter ? { runAfter: overrides.runAfter } : {}),
    },
  });
  return job.id;
}

export async function jobRow(jobId: string) {
  return prisma.reportJob.findUniqueOrThrow({ where: { id: jobId } });
}

export async function linesOf(jobId: string) {
  return prisma.reportLine.findMany({ where: { jobId }, orderBy: { productId: 'asc' } });
}

/**
 * What a correct report says, computed from the ledger rather than from the
 * job. A check that asked the job for the numbers it was verifying would only
 * prove the job agrees with itself.
 */
export async function expectedReport(): Promise<{ productId: string; onHand: number; value: number }[]> {
  const products = await prisma.product.findMany({ orderBy: { sku: 'asc' } });
  const rows: { productId: string; onHand: number; value: number }[] = [];
  for (const product of products) {
    const quantity = await onHand(product.id);
    rows.push({ productId: product.id, onHand: quantity, value: quantity * product.unitPrice });
  }
  return rows.sort((a, b) => (a.productId < b.productId ? -1 : 1));
}

/** A failure injected before the Nth product (0-based), once per run. */
export class InjectedFailure extends Error {
  constructor(readonly atIndex: number) {
    super(`Injected failure before item ${atIndex}`);
    this.name = 'InjectedFailure';
  }
}

export function failBeforeItem(index: number) {
  return (_productId: string, at: number): void => {
    if (at === index) throw new InjectedFailure(index);
  };
}
