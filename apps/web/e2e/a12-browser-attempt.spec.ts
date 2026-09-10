import { expect, test } from '@playwright/test';

/**
 * Execute a real exercise through the QuickJS runner in a real browser.
 *
 * The runner was proven under Node long before it worked in a browser: the
 * worker constructed fine, but the QuickJS `.wasm` request was answered with
 * index.html by the SPA fallback, so nothing ever executed. This spec is the
 * standing guard on the browser path.
 *
 * v1-e011 (`isBlank`) is a JavaScript `function` exercise with 8 cases. Its
 * starter is deliberately wrong (`!value` also calls 0 and false blank), so a
 * run against the starter MUST report failures — that is what proves the cases
 * discriminate rather than passing anything put in front of them.
 *
 * No test.skip anywhere: if the runner cannot be reached, that is a failure.
 */

const EXERCISE = 'v1-e011';
const ENTRYPOINT = 'isBlank';

/**
 * The exercise's own starter logic. The test SETS this explicitly rather than
 * trusting whatever is in the editor: drafts persist per owner, so once any
 * earlier run has saved a working solution, the "starter" that loads is no
 * longer wrong and the failure path would silently stop being tested.
 */
const WRONG = `function isBlank(value) {
  return !value;
}`;

const SOLUTION = `function isBlank(value) {
  if (value === null) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim() === '';
  }
  return false;
}`;

test.describe('browser runner', () => {
  // First contact with the practice chunk pays Vite's cold compile of the
  // QuickJS runtime and the TypeScript compiler, plus WASM instantiation.
  test.setTimeout(360_000);

  async function openEditor(page: import('@playwright/test').Page) {
    await page.goto(`/practice/${EXERCISE}`);
    const editor = page.getByLabel(`Code editor for ${ENTRYPOINT}`);
    await expect(editor, 'the practice editor must render').toBeVisible({ timeout: 180_000 });
    return editor;
  }

  async function replaceCode(page: import('@playwright/test').Page, code: string) {
    const editor = page.getByLabel(`Code editor for ${ENTRYPOINT}`);
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    // insertText, NOT type(): keystroke simulation fights CodeMirror's
    // auto-close-brackets, which appended stray `}` and swallowed a `/` in a
    // comment, turning it into a regex literal and producing a bogus
    // SyntaxError that also poisoned the saved draft.
    await page.keyboard.insertText(code);
  }

  test('a wrong solution fails, the reference solution passes, and the attempt is recorded', async ({
    page,
  }) => {
    const attemptRequests: string[] = [];
    const attemptResponses: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/attempts') && r.method() === 'POST') {
        attemptRequests.push(r.postData() ?? '');
      }
    });
    page.on('response', (r) => {
      if (r.url().includes('/api/v1/attempts')) {
        attemptResponses.push(`${r.status()} ${r.request().method()}`);
      }
    });
    page.on('pageerror', (e) => attemptResponses.push(`PAGEERROR ${e.message}`));

    const editor = await openEditor(page);
    await expect(editor).toContainText('isBlank');

    // Establish the known-wrong implementation, whatever the saved draft holds.
    await replaceCode(page, WRONG);

    // 1. The WRONG starter must report a partial failure. Asserted against the
    //    summary the UI actually renders: "Some cases did not pass. 5 of 8
    //    cases passed." Anchoring on "did not pass" plus a per-case Failed row
    //    means an all-passing run cannot satisfy this.
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(
      page.getByText(/Some cases did not pass\.\s*\d+ of 8 cases passed\./i),
      'running the deliberately wrong starter must report a partial failure',
    ).toBeVisible({ timeout: 180_000 });
    await expect(
      page.getByText(/Failed/).first(),
      'individual failing cases must be listed',
    ).toBeVisible();

    // 2. The reference solution must pass EVERY case. This is the real proof of
    //    execution — not the presence of a Submit button, which the UI also
    //    offers after a partially failing run (a legitimate failing attempt).
    await replaceCode(page, SOLUTION);
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(
      page.getByText(/All cases passed\.\s*8 of 8 cases passed\./i),
      'the reference solution must pass all 8 cases in the browser runner',
    ).toBeVisible({ timeout: 180_000 });

    // 3. The attempt is submitted and accepted by the server.
    await page.getByRole('button', { name: /Submit attempt/i }).click();
    await expect
      .poll(() => attemptResponses.filter((a) => a.startsWith('20')).length, {
        timeout: 60_000,
        message: () => `POST /attempts must be accepted. Saw: ${JSON.stringify(attemptResponses)}`,
      })
      .toBeGreaterThan(0);

    // 4. It must be recorded as browser-run evidence, not something else.
    const body = attemptRequests.find((b) => b.includes(EXERCISE)) ?? attemptRequests[0] ?? '';
    expect(body, 'the attempt payload must be sent').not.toBe('');
    expect(JSON.parse(body).gradingOrigin).toBe('browser_automated');

    expect(attemptResponses.filter((a) => a.startsWith('PAGEERROR'))).toEqual([]);
  });

  test('the code draft survives a reload (A04, browser half)', async ({ page }) => {
    await openEditor(page);

    // A single contiguous token. CodeMirror's gutter interleaves line numbers
    // into textContent ("9123456789>function isBlank...") and collapses
    // newlines, so asserting multi-line source is fragile — but a token with no
    // whitespace survives intact on its own line.
    const marker = `DRAFTMARKER${Date.now()}`;

    // Arm the wait BEFORE typing. Autosave can fire while replaceCode is still
    // running, and waitForResponse only observes responses that arrive after it
    // is called — registering it afterwards misses the write and times out.
    const draftSaved = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.startsWith('/api/v1/drafts') &&
        r.request().method() !== 'GET' &&
        r.ok(),
      { timeout: 60_000 },
    );

    await replaceCode(page, `// ${marker}\n${SOLUTION}`);

    // Wait for the server to acknowledge the draft write, not just the debounce.
    await draftSaved;

    await page.reload();
    const editor = page.getByLabel(`Code editor for ${ENTRYPOINT}`);
    await expect(editor).toBeVisible({ timeout: 180_000 });

    // The draft came back from the server, and it is the code we wrote.
    await expect(editor, 'the saved draft must come back after a reload').toContainText(marker);
    await expect(editor, 'the draft body must come back too').toContainText('trim()');
  });
});
