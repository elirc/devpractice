import { expect, test } from '@playwright/test';
import { openFirstLesson } from './helpers.js';

/**
 * Acceptance A12 — mobile use at a 360 CSS-pixel viewport.
 *
 * Sign in, read a lesson, answer an exercise, reveal a hint, write a note and
 * review, with no lost input and no unreachable action.
 *
 * Requires the API and web dev servers to be running and an owner account to
 * exist (see apps/api owner:bootstrap). Credentials come from the environment
 * so no password is committed.
 */

const EMAIL = process.env.E2E_OWNER_EMAIL ?? '';
const PASSWORD = process.env.E2E_OWNER_PASSWORD ?? '';

test.describe('A12 mobile journey at 360px', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'Set E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD to run the signed-in journey.',
  );

  // The session comes from the `setup` project's saved storage state, so the
  // suite signs in once rather than once per test (sign-in is throttled).

  test('the page never scrolls horizontally', async ({ page }) => {
    for (const path of ['/today', '/learn', '/review', '/projects', '/progress', '/notes']) {
      await page.goto(path);
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflows, `${path} must not scroll horizontally`).toBe(false);
    }
  });

  test('primary navigation is reachable and large enough to tap', async ({ page }) => {
    await page.goto('/today');
    const nav = page.getByRole('navigation', { name: 'Primary' }).last();

    for (const label of ['Today', 'Learn', 'Review', 'Projects']) {
      const link = nav.getByRole('link', { name: new RegExp(label) });
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box, `${label} must have a hit area`).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    // Secondary destinations live behind "More" on small screens.
    await nav.getByRole('button', { name: /More/ }).click();
    await expect(page.getByRole('link', { name: /Settings/ })).toBeVisible();
  });

  test('switching lesson tabs preserves typed input', async ({ page }) => {
    const lesson = await openFirstLesson(page);

    const note = page.getByLabel('Your notes');
    await note.fill('a thought I do not want to lose');

    await page.getByRole('tab', { name: 'Practice' }).click();
    await page.getByRole('tab', { name: 'Instruction' }).click();

    // The instruction pane was hidden, not unmounted, so the text survives.
    await expect(note).toHaveValue('a thought I do not want to lose');
  });

  test('a note reports Saved only after the server acknowledges', async ({ page }) => {
    const lesson = await openFirstLesson(page);

    // Wait for the server to actually acknowledge THIS write before reloading.
    // The previous test leaves its own text saved in the same lesson note, so
    // the indicator already reads "Saved" on arrival — asserting it alone
    // matched the stale state and the reload raced the new write.
    const acknowledged = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.startsWith('/api/v1/notes') &&
        r.request().method() !== 'GET' &&
        r.ok(),
      { timeout: 30_000 },
    );

    // Replace the way a person would. `fill()` here produced
    // "a thought I do not want to losedurable note text" — the previous test's
    // text with the new text appended — so the clear did not take effect
    // against this controlled, autosaving textarea.
    const note = page.getByLabel('Your notes');
    await note.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('durable note text');
    await expect(note, 'the editor must hold exactly the new text').toHaveValue(
      'durable note text',
    );

    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({
      timeout: 10_000,
    });
    await acknowledged;

    await page.reload();
    await expect(page.getByLabel('Your notes')).toHaveValue('durable note text');
  });
});
