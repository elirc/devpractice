import { expect, test } from '@playwright/test';
import { openFirstLesson } from './helpers.js';

/**
 * Acceptance A14 — network recovery.
 *
 * An interrupted save shows Unsaved and keeps the text; on reconnect the client
 * works from the CURRENT revision; nothing is silently overwritten and no
 * completion is duplicated.
 */

/** Matches every /api/v1/notes URL, including /notes/<id>. */
const NOTE_WRITES = (url: URL): boolean => url.pathname.startsWith('/api/v1/notes');

const EMAIL = process.env.E2E_OWNER_EMAIL ?? '';
const PASSWORD = process.env.E2E_OWNER_PASSWORD ?? '';

test.describe('A14 interrupted save', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'Set E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD to run the signed-in journey.',
  );

  // The session comes from the `setup` project's saved storage state, so the
  // suite signs in once rather than once per test (sign-in is throttled).

  test('a failed save keeps the text and shows Unsaved', async ({ page }) => {
    const lesson = await openFirstLesson(page);

    // Break note writes only; reads still work.
    // A URL predicate, not a glob. `**/api/v1/notes**` silently failed to match
    // `/api/v1/notes/<id>`, so the PATCH went through with 200 and this test
    // never actually simulated a network failure — it passed its "Unsaved"
    // check on a transient typing state while the save quietly succeeded.
    await page.route(NOTE_WRITES, async (route) => {
      if (route.request().method() === 'GET') return route.continue();
      return route.abort('failed');
    });

    const note = page.getByLabel('Your notes');
    await note.fill('text written while the network is down');

    await expect(page.getByRole('status').filter({ hasText: 'Unsaved' })).toBeVisible({
      timeout: 10_000,
    });
    // The draft is never discarded on a failed write.
    await expect(note).toHaveValue('text written while the network is down');
    await expect(page.getByRole('alert')).toContainText(/still here/i);

    // Restore the network; the retry then succeeds.
    await page.unroute(NOTE_WRITES);
    await page.getByRole('button', { name: /Retry/i }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('a stale write conflicts instead of overwriting', async ({ page, context }) => {
    const lessonUrl = await openFirstLesson(page);

    await page.getByLabel('Your notes').fill('first device version');
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({
      timeout: 10_000,
    });

    // A second device edits the same note and saves.
    const second = await context.newPage();
    await second.goto(lessonUrl);
    await second.getByLabel('Your notes').fill('second device version');
    await expect(second.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({
      timeout: 10_000,
    });

    // The first page still holds the old revision; its next write must conflict.
    await page.getByLabel('Your notes').fill('first device, later edit');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    // BOTH texts are offered; neither has been destroyed.
    await expect(dialog).toContainText('first device, later edit');
    await expect(dialog).toContainText('second device version');
    await expect(dialog.getByRole('button', { name: /Keep server version/i })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Save my version/i })).toBeVisible();

    await second.close();
  });
});
