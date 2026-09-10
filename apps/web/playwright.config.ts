import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end journeys (acceptance A12, A14).
 *
 * The app and API are served from ONE origin, so these tests point at the dev
 * server which proxies /api to the API process. Both must be running:
 *   pnpm --filter @devpractice/api dev
 *   pnpm --filter @devpractice/web dev
 */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  /**
   * This machine is slow and often runs several suites at once. Argon2id at
   * production cost makes a sign-in round trip take ~2.5s on its own, and the
   * dev server needs ~60s to boot. The default 5s expect budget expired during
   * sign-in and made a WORKING login look like a failure.
   *
   * These raise only the waiting budget. No assertion is relaxed: a journey
   * that never reaches its expected state still fails.
   */
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: BASE_URL,
    /**
     * Tracing is off: writing the trace zip on this slow, contended disk failed
     * with "end of central directory record signature not found" and reported
     * the TEST as failed even though its assertions had passed. Screenshots are
     * cheap and reliable, so they stay. Re-enable tracing when diagnosing a
     * specific failure on a machine with healthy IO.
     */
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: './node_modules/.bin/vite --port 5173 --strictPort',
        url: BASE_URL,
        reuseExistingServer: true,
        // Vite's first cold start here has been measured at ~62s; 180s left no
        // margin under load. `npx` also resolved the wrong binary on this box.
        timeout: 360_000,
      },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
      /**
       * Shell rules only. A12 is defined as MOBILE use at 360 CSS pixels and
       * asserts against the small-screen navigation (the "More" sheet), which
       * does not exist in the desktop sidebar — running it here produced
       * failures that said nothing about the product. A14 is viewport-agnostic
       * and runs once, in the mobile project, so the suite signs in half as
       * often: sign-in is throttled per account, and 22 logins tripped the
       * limiter and cascaded into unrelated failures.
       */
      testMatch: /shell\.spec\.ts/,
    },
    {
      // Acceptance A12 requires a 360 CSS-pixel viewport.
      name: 'mobile-360',
      dependencies: ['setup'],
      // Only the signed-in journeys. shell.spec.ts asserts UNAUTHENTICATED
      // behaviour and runs in desktop-chromium; running it here with a restored
      // session made "anonymous visitor is redirected" fail by design.
      testMatch: /a1[24]-.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 360, height: 740 },
        isMobile: false,
        hasTouch: true,
        // Reuse the one session established by the setup project.
        storageState: 'e2e/.auth/owner.json',
      },
    },
  ],
});
