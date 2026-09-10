import { test as setup, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { signIn } from './helpers.js';

/**
 * Sign in ONCE and save the session for the signed-in journeys.
 *
 * Sign-in is deliberately throttled per account (spec 6: five failures per
 * fifteen minutes). A suite that signs in inside every beforeEach issued a
 * dozen logins per run and tripped that limiter, which then failed unrelated
 * journeys with a misleading "stayed on /login". Reusing one session keeps the
 * throttle doing its real job instead of fighting the test suite.
 *
 * The login form itself is still exercised: here, and in shell.spec.ts.
 */

export const OWNER_STATE = 'e2e/.auth/owner.json';

setup('authenticate once', async ({ page }) => {
  const email = process.env.E2E_OWNER_EMAIL ?? '';
  const password = process.env.E2E_OWNER_PASSWORD ?? '';
  expect(email, 'E2E_OWNER_EMAIL must be set').not.toBe('');
  expect(password, 'E2E_OWNER_PASSWORD must be set').not.toBe('');

  await signIn(page, email, password);

  mkdirSync(dirname(OWNER_STATE), { recursive: true });
  await page.context().storageState({ path: OWNER_STATE });
});
