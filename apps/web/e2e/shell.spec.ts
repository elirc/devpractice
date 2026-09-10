import { expect, test } from '@playwright/test';

/**
 * Shell checks that do not need a signed-in owner, so they run against the web
 * app alone. They cover the responsive and accessibility rules that hold before
 * any content exists (spec 4.5).
 */

test.describe('unauthenticated shell', () => {
  test('an anonymous visitor is sent to the sign-in screen', async ({ page }) => {
    await page.goto('/today');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'DevPractice' })).toBeVisible();
  });

  test('the sign-in form is properly labelled and keyboard reachable', async ({ page }) => {
    await page.goto('/login');

    const email = page.getByLabel('Email');
    const password = page.getByLabel('Password');
    const submit = page.getByRole('button', { name: 'Sign in' });

    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    await expect(password).toHaveAttribute('type', 'password');

    await email.focus();
    await page.keyboard.type('owner@example.test');
    await page.keyboard.press('Tab');
    await page.keyboard.type('secret');
    await expect(password).toHaveValue('secret');

    // The submit control meets the minimum touch target.
    const box = await submit.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('the sign-in page does not scroll horizontally', async ({ page }) => {
    await page.goto('/login');
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });

  test('it states that there is no public registration', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText(/no public registration/i)).toBeVisible();
  });

  test('the dark theme is applied when the system prefers it', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');
    const background = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor,
    );
    // The dark ground is a very dark colour, not the light default.
    expect(background).not.toBe('rgb(247, 247, 245)');
  });
});
