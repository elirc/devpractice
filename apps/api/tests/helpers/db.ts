import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * Disposable PostgreSQL for integration tests (spec 14.1).
 *
 * These tests run against a REAL database with the real migrations applied.
 * Mocking the repository layer and then claiming synchronization works would
 * prove nothing about the constraints and transactions that actually enforce
 * it.
 */

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Start the database (docker compose up -d db) and copy .env.example to .env.',
    );
  }
  return url;
}

let migrated = false;

/**
 * Apply migrations once per test process.
 *
 * Uses a shell invocation: on Windows, spawning the `npx.cmd` shim directly
 * fails with EINVAL under current Node releases.
 */
export function ensureMigrated(): void {
  if (migrated) return;
  // Use the workspace-local binary, never `npx`: on Windows the npx shim can
  // hang indefinitely resolving the package instead of running the local one.
  const bin = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
  execSync(`"${join(process.cwd(), 'node_modules', '.bin', bin)}" migrate deploy --schema ../../prisma/schema.prisma`, {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'inherit',
  });
  migrated = true;
}

export function createTestClient(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: testDatabaseUrl() } },
    log: ['warn', 'error'],
  });
}

/**
 * Truncate every table between tests so fixtures stay deterministic.
 * CASCADE handles the foreign keys; RESTART IDENTITY resets sequences.
 *
 * IMPORTANT: this wipes the WHOLE database, so two test suites must never
 * share one. Running the foundation and learning suites concurrently against
 * the same TEST_DATABASE_URL makes each delete the other's fixtures, which
 * surfaces as unique-constraint violations, spurious 404s and timeouts rather
 * than as an obvious conflict. Give each suite its own database.
 */
export async function resetDatabase(db: PrismaClient): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
