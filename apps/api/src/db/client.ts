import { PrismaClient } from '@prisma/client';

/**
 * Single Prisma client for the platform database.
 * Learning-project databases are separate and are never reachable from here.
 */
const globalRef = globalThis as unknown as { __dpPrisma?: PrismaClient };

export const prisma =
  globalRef.__dpPrisma ??
  new PrismaClient({
    log: process.env.LOG_LEVEL === 'debug' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') globalRef.__dpPrisma = prisma;

/** Transaction handle type shared by every service. */
export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
