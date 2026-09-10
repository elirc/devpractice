import { expect, type Page } from '@playwright/test';

/**
 * Shared navigation for the signed-in journeys.
 *
 * These helpers deliberately do NOT skip when content is missing. The suite is
 * run against a published V1 release, so an absent chapter or lesson link is a
 * real defect in navigation — silently skipping would turn that defect into a
 * green run, which is worse than an honest failure.
 */

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today/);
}

/** Open the first lesson of the first chapter, asserting each step exists. */
export async function openFirstLesson(page: Page): Promise<string> {
  await page.goto('/learn');

  // Chapters are addressed explicitly; the first link on the page is chrome.
  const chapterLink = page.locator('a[href^="/learn/chapters/"]').first();
  await expect(chapterLink, 'the published release must expose at least one chapter').toBeVisible();
  await chapterLink.click();

  const lessonLink = page.locator('a[href^="/learn/lessons/"]').first();
  await expect(lessonLink, 'the chapter must expose at least one lesson').toBeVisible();
  await lessonLink.click();

  await expect(page).toHaveURL(/\/learn\/lessons\//);
  return page.url();
}
