import { PrismaClient, MovementReason } from '@prisma/client';

/**
 * Repeatable seed: running it twice produces the same data, not duplicates.
 * Every record is fictional.
 */
const prisma = new PrismaClient();

const USERS = [
  { id: 'user-mira', displayName: 'Mira (stock controller)' },
  { id: 'user-tomas', displayName: 'Tomas (stock controller)' },
];

const PRODUCTS = [
  { id: 'prod-ink-black', sku: 'INK-BLK-01', name: 'Black ink cartridge', unitPrice: 2450 },
  { id: 'prod-ink-colour', sku: 'INK-COL-01', name: 'Colour ink cartridge', unitPrice: 3180 },
  { id: 'prod-paper-a4', sku: 'PAP-A4-500', name: 'A4 paper, 500 sheets', unitPrice: 640 },
  { id: 'prod-roll-till', sku: 'ROL-TILL-10', name: 'Till roll, pack of 10', unitPrice: 1195 },
  { id: 'prod-label-sm', sku: 'LBL-SM-1K', name: 'Small labels, 1000', unitPrice: 890 },
];

/** Opening stock, expressed as ledger movements rather than a stored total. */
const OPENING = [
  { id: 'mov-open-1', productId: 'prod-ink-black', delta: 40 },
  { id: 'mov-open-2', productId: 'prod-ink-colour', delta: 25 },
  { id: 'mov-open-3', productId: 'prod-paper-a4', delta: 120 },
  { id: 'mov-open-4', productId: 'prod-roll-till', delta: 60 },
  { id: 'mov-open-5', productId: 'prod-label-sm', delta: 0 },
];

async function main(): Promise<void> {
  for (const user of USERS) {
    await prisma.trainingUser.upsert({ where: { id: user.id }, create: user, update: { displayName: user.displayName } });
  }
  for (const product of PRODUCTS) {
    await prisma.product.upsert({ where: { id: product.id }, create: product, update: product });
  }
  for (const movement of OPENING) {
    if (movement.delta === 0) continue; // a zero movement is not a real event
    const data = { ...movement, reason: MovementReason.received, createdAt: new Date('2026-09-01T08:00:00.000Z') };
    await prisma.stockMovement.upsert({ where: { id: movement.id }, create: data, update: data });
  }
  console.log('Seeded', {
    users: await prisma.trainingUser.count(),
    products: await prisma.product.count(),
    movements: await prisma.stockMovement.count(),
  });
}

main()
  .catch((error: unknown) => { console.error(error); process.exit(1); })
  .finally(() => prisma.$disconnect());
