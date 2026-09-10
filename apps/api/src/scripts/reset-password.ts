import { prisma } from '../db/client.js';
import { systemClock } from '../lib/clock.js';
import { checkPasswordPolicy, hashPassword } from '../lib/password.js';
import { normalizeEmail } from '../lib/tokens.js';
import { promptLine, readPassword } from './prompt.js';

/**
 * Reset the owner's password and revoke every existing session (spec 6).
 * Email-based recovery is deliberately deferred; this local command is the
 * recovery path.
 *
 * Usage:
 *   pnpm owner:reset-password
 *   OWNER_EMAIL=... OWNER_PASSWORD=... pnpm owner:reset-password
 */
async function main(): Promise<void> {
  const email = process.env.OWNER_EMAIL ?? (await promptLine('Owner email: '));
  const normalizedEmail = normalizeEmail(email);

  const user = await prisma.user.findUnique({ where: { normalizedEmail } });
  if (!user) {
    throw new Error('No owner account with that email.');
  }

  const password = await readPassword('OWNER_PASSWORD', 'New password');
  const policy = checkPasswordPolicy(password);
  if (!policy.ok) {
    throw new Error(`Password rejected: ${policy.problems.join(' ')}`);
  }

  const passwordHash = await hashPassword(password);

  // One transaction: a reset that did not revoke sessions would leave a stolen
  // cookie working against the new password.
  const revoked = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    const result = await tx.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: systemClock.now() },
    });
    return result.count;
  });

  console.log(`Password updated for ${user.displayEmail}.`);
  console.log(`Revoked ${revoked} active session(s). Sign in again on every device.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
