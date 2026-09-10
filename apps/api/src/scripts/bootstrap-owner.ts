import { prisma } from '../db/client.js';
import { checkPasswordPolicy, hashPassword } from '../lib/password.js';
import { normalizeEmail } from '../lib/tokens.js';
import { promptLine, readPassword } from './prompt.js';

/**
 * Create the single owner account (spec 6).
 *
 * This is an administration command run locally by the owner. There is no
 * public signup and no unauthenticated production endpoint that does this.
 *
 * Usage:
 *   pnpm owner:bootstrap
 *   OWNER_EMAIL=... OWNER_PASSWORD=... pnpm owner:bootstrap   (non-interactive)
 */
async function main(): Promise<void> {
  const email = process.env.OWNER_EMAIL ?? (await promptLine('Owner email: '));
  if (!email || !email.includes('@')) {
    throw new Error('A valid email address is required.');
  }
  const normalizedEmail = normalizeEmail(email);

  const existing = await prisma.user.findUnique({ where: { normalizedEmail } });
  if (existing) {
    // Never overwrite an existing account by accident; resetting is its own command.
    throw new Error(
      'An owner account with that email already exists. Use `pnpm owner:reset-password` to change its password.',
    );
  }

  const ownerCount = await prisma.user.count();
  if (ownerCount > 0 && process.env.ALLOW_ADDITIONAL_OWNERS !== 'true') {
    throw new Error(
      'An owner account already exists. This is a single-owner application; set ALLOW_ADDITIONAL_OWNERS=true only to create a synthetic test account.',
    );
  }

  const password = await readPassword('OWNER_PASSWORD', 'Choose a password');
  const policy = checkPasswordPolicy(password);
  if (!policy.ok) {
    throw new Error(`Password rejected: ${policy.problems.join(' ')}`);
  }

  const user = await prisma.user.create({
    data: {
      normalizedEmail,
      displayEmail: email.trim(),
      passwordHash: await hashPassword(password),
    },
  });

  // Log the identifier, never the credential.
  console.log(`Owner account created: ${user.displayEmail} (${user.id})`);
  console.log('Sign in at the application origin. No further setup is required.');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
