import { prisma } from '../db/client.js';
import { systemClock } from '../lib/clock.js';

/**
 * Scheduled maintenance (spec 8.3).
 *
 * Prunes only expendable rows: expired sessions, old mutation receipts, and
 * stale login-attempt records. Attempts, reveals, reviews and content history
 * are the learning record and are retained by default — this command never
 * deletes them.
 *
 * Mutation receipts are kept for at least 30 days. Beyond that the durable
 * unique event ids on the underlying tables (Attempt, RevealEvent, ReviewEvent,
 * PlacementAttempt) continue to prevent duplicates.
 */
const RECEIPT_RETENTION_DAYS = 30;
const LOGIN_ATTEMPT_RETENTION_DAYS = 30;

async function main(): Promise<void> {
  const now = systemClock.now();
  const receiptCutoff = new Date(now.getTime() - RECEIPT_RETENTION_DAYS * 86_400_000);
  const loginCutoff = new Date(now.getTime() - LOGIN_ATTEMPT_RETENTION_DAYS * 86_400_000);

  const sessions = await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  const receipts = await prisma.mutationReceipt.deleteMany({
    where: { createdAt: { lt: receiptCutoff } },
  });
  const logins = await prisma.loginAttempt.deleteMany({
    where: { createdAt: { lt: loginCutoff } },
  });

  console.log(
    JSON.stringify({
      prunedAt: now.toISOString(),
      expiredSessions: sessions.count,
      oldReceipts: receipts.count,
      oldLoginAttempts: logins.count,
    }),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
