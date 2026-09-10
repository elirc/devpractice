# End-to-end verification record

What was actually run for acceptance **A12** (mobile use at 360 CSS pixels) and
**A14** (network recovery), on 2026-09-09/10, and what the runs found.

Nothing in this file is inferred. Every result below came from a real run on
this machine.

## Environment

| Piece | Value |
|---|---|
| Browser | Chromium r1148 (matching pinned `@playwright/test` 1.49.0) |
| API | `apps/api` on `http://127.0.0.1:3001`, started from `src/server.ts` |
| Web | Vite 5.4.11 dev server on `http://localhost:5173`, proxying `/api` |
| Database | PostgreSQL 18 on `127.0.0.1:5440` (Docker is broken on this machine) |
| Content | The full V1 release, imported and published through the real API |

WebKit and Firefox were **not** exercised. Only Chromium is verified.

## Setup performed

1. `packages/content-tools` → `cli.ts build --target v1` produced
   `curriculum/dist/devpractice-v1.json`, verified on the **QuickJS** backend:
   33 solutions passing, 33 starters failing as required, 212 wrong
   implementations rejected, 2 surviving mutants (documented as equivalent in
   `known-limitations.md`).
2. `src/scripts/seed.ts` seeded the concept catalogue.
3. `src/scripts/bootstrap-owner.ts` created the owner (password injected via
   environment, never argv, never logged).
4. `src/scripts/publish-release.ts` (added here) signed in and drove
   `POST /content/imports` → `POST /content/imports/:id/publish` over HTTP.
   Published **244 items**; `GET /curriculum` then returned 1 track and 12
   chapters.

Publishing deliberately goes through the real endpoints rather than writing
release rows directly, so local setup exercises the same publication path as
production (spec 10.4).

## Results — final run

| Suite | Result |
|---|---|
| `shell.spec.ts` (desktop-chromium, unauthenticated) | **5/5 pass** |
| A12 — page never scrolls horizontally at 360px (6 routes) | **pass** |
| A12 — primary nav reachable, ≥44px touch targets, More sheet | **pass** |
| A12 — switching lesson tabs preserves typed input | **FAIL** — blocked by defect 1 |
| A12 — note reports Saved only after server acknowledges | **FAIL** — blocked by defect 1 |
| A14 — failed save keeps text and shows Unsaved | **FAIL** — blocked by defect 1 |
| A14 — stale write conflicts instead of overwriting | **FAIL** — blocked by defect 1 |

**A12 is partially verified. A14 is not verified.** Both are blocked by a single
application defect, below.

## Defect 1 — chapter page crashes, breaking the whole learning journey

**Severity: high. Every chapter page is unusable.**

`apps/web/src/features/learn/ChapterPage.tsx:30`

    const unmetPrerequisites = data.prerequisiteChapters.filter((p) => !p.satisfied);

`GET /api/v1/chapters/:id` returns 200 with these keys:

    id, title, trackId, bodyMarkdown, objectiveIds, prerequisiteIds,
    assessmentId, missionIds, placedOut, placementAvailable, lessons

There is no `prerequisiteChapters`. The component reads `undefined.filter`, the
router's error boundary catches it, and the page renders:

    Unexpected Application Error!
    Cannot read properties of undefined (reading 'filter')
    TypeError: ... at ChapterPage (ChapterPage.tsx:51:56)

Because the chapter page is the only route linking to `/learn/lessons/:id`, no
lesson is reachable through the UI, so every lesson-dependent journey fails.
The API itself is fine — it returns all three lessons for `v1-ch01`.

Fix is a contract decision for the API and web owners, not a test change:
either the web component consumes `prerequisiteIds`, or `GET /chapters/:id`
returns resolved `prerequisiteChapters` objects with `{ id, title, satisfied }`.
This file was outside the e2e agent's ownership and was deliberately not edited.

## Defect 2 — `GET /api/v1/today` returns 404

`apps/web/src/lib/queries.ts:63` calls `apiGet<TodayDto>('/today')`. No such
route exists; it 404'd 22 times across these runs. Spec 9.2 does not list a
`GET /today`, so either the endpoint should be added or the Today screen should
compose from `/activity`, `/reviews/due`, `/progress` and `/missions`.

It does **not** block sign-in (that was ruled out by direct diagnosis), but it
means the Today screen is running on a failing query.

## Things that looked like defects and were not

Recording these because each cost real time and would otherwise be re-diagnosed.

1. **"Login is broken at 360px."** It was not. The credential had been changed
   underneath the run — the shared owner account's `updatedAt` moved after the
   password was set, because another workstream was resetting the same account
   on the same development database. Resolved by creating a dedicated
   `e2e-runner@devpractice.test` owner so the suite no longer shares an account
   with other work.
2. **"The sandbox/session is failing."** No — sign-in throttling was doing its
   job. The suite signed in inside every `beforeEach`; a dozen logins per run
   plus a few genuine failures tripped the five-failures-per-fifteen-minutes
   limiter, and the resulting 429s surfaced as a misleading "stayed on /login".
   Fixed in the suite, not the product: `auth.setup.ts` signs in **once** and
   the journeys reuse that session.
3. **"A12 fails on desktop."** A12 is defined as *mobile* use at 360px and
   asserts against the small-screen "More" navigation, which does not exist in
   the desktop sidebar. Running it in the desktop project produced failures that
   said nothing about the product; it now runs only in `mobile-360`.
4. **"The horizontal-scroll test fails."** Its assertions passed; Playwright
   failed writing the trace zip on this contended disk
   (`end of central directory record signature not found`). Tracing is off by
   default here and should be re-enabled when diagnosing on healthy IO.

## Changes made to the suite

All within e2e ownership; no assertion was weakened.

- `playwright.config.ts` — raised waiting budgets only (`timeout` 120s,
  `expect.timeout` 20s, webServer 360s) because Argon2id sign-in costs ~2.5s and
  Vite's cold start was measured at ~62s; project scoping as described above;
  `trace: 'off'`.
- `e2e/auth.setup.ts` — new; signs in once and saves storage state.
- `e2e/helpers.ts` — `openFirstLesson` now **asserts** that a chapter and a
  lesson link exist. It previously returned null and the specs called
  `test.skip`, which silently turned missing navigation into a green run. That
  silent skip is what hid defect 1; it now fails loudly, which is how the defect
  was found.

## Not verified

- A14 in full, and the two lesson-dependent A12 journeys — blocked by defect 1.
- Any browser other than Chromium.
- The practice/runner UI inside a real browser: no journey reaches an exercise
  while the chapter page crashes.

---

# Re-run after defect 1 and defect 2 were fixed

Second run, same stack (Chromium r1148, API + Vite, PostgreSQL 5440, the real
published V1 release under `e2e-runner@devpractice.test`).

Both earlier defects are confirmed fixed at the API level:

    GET /today        -> 200  resume, reviewsDue, activeMission, recentActivity, totalXp, level
    GET /chapters/:id -> 200  ... trackTitle, prerequisiteIds, missions,
                               lessonCount, completedLessonCount, lessons(3)

## Results — 9 passed, 3 failed (previously 8 passed, 4 failed)

| Gate | Result |
|---|---|
| `shell.spec.ts` unauthenticated (5) | pass |
| A12 — no horizontal scroll at 360px (6 routes) | pass |
| A12 — nav reachable, >=44px touch targets | pass |
| A12 — **switching lesson tabs preserves typed input** | **now passes** |
| A12 — note reports Saved only after acknowledgement | FAIL — defect 3 |
| A14 — failed save keeps text and shows Unsaved | FAIL — defect 3 |
| A14 — stale write conflicts instead of overwriting | FAIL — defect 3 |

Defect 1 is genuinely fixed: the chapter page renders and lesson navigation
works, so the journeys now reach a lesson. **A12 remains partially verified and
A14 remains unverified**, now blocked by a different defect.

## Defect 3 — CSRF header name mismatch breaks every write

**Severity: high. No state-changing request from the web app can succeed.**

The API reads the CSRF token from `x-devpractice-csrf`:

    apps/api/src/plugins/csrf.ts:18   export const CSRF_HEADER = 'x-devpractice-csrf';

The web client sends `x-csrf-token`:

    apps/web/src/lib/api.ts:103                    headers['x-csrf-token'] = token;
    apps/web/src/features/practice/api.ts:37       headers.set('x-csrf-token', ...);

Observed this run: `GET /api/v1/notes` succeeded 12 times (reads need no token)
while `POST /api/v1/notes` returned **403** every time. The note is never
persisted, so after a reload the textarea is empty and the journey fails.

This blocks far more than notes: drafts, attempts, hint/solution reveals, review
responses, settings, mission progress and content publication are all
state-changing and all carry the same header.

**Why no unit test caught it** — the client's own test asserts the wrong name:

    apps/web/src/lib/api.test.ts:58
    expect((init.headers as Record<string,string>)['x-csrf-token']).toBe('token-123');

The suite passes 33/33 against a mocked `fetch` that never checks what the
server actually requires, so the test encodes the bug rather than catching it.
Fixing the client without fixing this assertion will turn the unit suite red.

Fix is one header name in three places (two source, one test). All are outside
e2e ownership and were deliberately not edited.

### Note on the A14 "Unsaved" journey

That test got further than the other two: the **Unsaved indicator did appear and
the typed text was preserved** — both genuine A14 requirements. It then failed
asserting an element with `role="alert"` matching /still here/. Whether that is
a missing alert or test copy that never matched the UI cannot be settled while
every write 403s; re-evaluate it once defect 3 is fixed.

## Still not verified

- A14 in full; the A12 note-persistence journey.
- Any engine other than Chromium.
- The practice runner in a real browser — reachable now, but every attempt
  submission is a POST and would 403.

---

# Third run — after defect 3 (CSRF header) was fixed

Same stack. `CSRF_HEADER` now comes from `@devpractice/contracts` and every
caller imports it, so the client and server can no longer disagree.

**Defect 3 is fixed and writes work.** Direct evidence from the runs: notes are
created and updated over HTTP (no more 403s), and the stale-write journey got
far enough to save "first device version" on one page and "second device
version" on a second page, each reporting Saved.

## Two runs of identical code gave different results

| Test | Run A | Run B |
|---|---|---|
| setup + shell (6) | pass | pass |
| A12 no horizontal scroll at 360px | pass | pass |
| A12 nav reachable / touch targets | pass | pass |
| A12 lesson tabs preserve typed input | pass | pass |
| A12 note reports Saved only after ack | **pass (8.1s)** | **FAIL (28.8s)** |
| A14 failed save keeps text, shows Unsaved | FAIL | FAIL |
| A14 stale write conflicts | FAIL | FAIL |
| **Totals** | **10 passed / 2 failed** | **9 passed / 3 failed** |

The difference is timing, not code. **A12 note persistence is flaky, not
passing.** It is reported here as not reliably passing.

## Defect 4 — ExercisePanel crashes on every exercise, taking the lesson page down

**Severity: high. It is also what makes the results above non-deterministic.**

`GET /api/v1/exercises/:id` returns an envelope:

    data: { exercise, draft }

`apps/web/src/features/practice/ExercisePanel.tsx` treats that payload as the
exercise itself — `exercise.grading`, `exercise.localOnly`, `exercise.id`,
`exercise.versionId`. So `grading` is `undefined` and `renderBody` throws:

    TypeError: Cannot read properties of undefined (reading 'kind')
        at renderBody (apps/web/src/features/practice/ExercisePanel.tsx:245)
        at ExercisePanel (apps/web/src/features/practice/ExercisePanel.tsx:171)

Captured directly in the browser, with `GET /api/v1/exercises/v1-e001`
returning **200** immediately before the crash.

The panel is lazily loaded, so it renders a few seconds after the lesson page
settles. When it throws, the router error boundary replaces the whole lesson
route with "Unexpected Application Error!", **unmounting the note editor**.
That is why:

- both A14 journeys fail — `getByLabel('Your notes')` disappears mid-test, so
  the save-failure alert and the conflict dialog can never be observed;
- A12 note persistence passes or fails depending on whether the assertion
  finishes before the crash lands.

Fix is a contract decision, in files outside e2e ownership and not edited here:
either `ExercisePanel` reads `data.exercise` (and gets `data.draft` alongside),
or `GET /exercises/:id` returns the exercise flat.

## Answer to the open question about the /still here/ alert

It is **neither a missing affordance nor test-copy drift** — the assertion and
the UI agree. The affordance exists and is unit-tested:

    apps/web/src/lib/useAutosave.ts:147   'Could not reach the server. Your text is still here.'
    apps/web/src/components/NoteEditor.tsx:149   <p role="alert"> ... <Button>Retry</Button>
    apps/web/src/lib/useAutosave.test.ts:239     expect(errorMessage).toMatch(/still here/i)

Every failure branch sets a message containing "still here". The alert is absent
at assertion time only because defect 4 has already unmounted the editor. Keep
the assertion as written and re-evaluate once defect 4 is fixed.

## Still not verified

- A14, both journeys.
- A12 note persistence (flaky; blocked by defect 4).
- **An exercise attempt submitted from a real browser.** This was the last gap in
  the runner's verification, which has only ever run under Node. It remains open:
  the practice panel crashes before an attempt can be made, so no browser-side
  attempt could be submitted.
- Any engine other than Chromium.

---

# Fourth pass — after defect 4 (ExercisePanel envelope) was fixed

Two full runs, as is now standard practice.

| Test | Run 1 | Run 2 |
|---|---|---|
| setup + shell (6) | pass | pass |
| A12 no horizontal scroll at 360px | pass | pass |
| A12 nav reachable / touch targets | pass | pass |
| A12 lesson tabs preserve typed input | pass | pass |
| A12 note reports Saved only after ack | **pass** | **pass** |
| A14 failed save keeps text, shows Unsaved | **pass** | **pass** |
| A14 stale write conflicts | **pass** | **pass** |
| Browser exercise attempt (new) | FAIL | FAIL |
| **Totals** | **12 passed / 1 failed** | **12 passed / 1 failed** |

Identical results across both runs, and the one failure fails for the same
reason each time. Nothing here is flaky.

**A12 passes. A14 passes.** Both journeys are genuinely verified in Chromium
against the real published V1 release.

## The /still here/ alert fires

Confirmed. With a genuinely failing write the sequence is: Unsaved indicator
appears, the typed text is preserved, and an element with `role="alert"`
containing "Your text is still here." renders with a working Retry that
succeeds once the network is restored.

My earlier reading — that the affordance existed and was only unmounted — was
half right. It did exist, but it had never once been exercised, because of the
test bug below.

## Two test bugs found and fixed (both in e2e, which this agent owns)

1. **A14 never simulated a network failure.** The route glob
   `'**/api/v1/notes**'` did not match `/api/v1/notes/<id>`, so the PATCH went
   through and returned **200**. The test still "saw" Unsaved — a transient
   state while typing — and then failed looking for the alert. Replaced with a
   URL predicate (`url.pathname.startsWith('/api/v1/notes')`), which aborts the
   write for real. The assertions are unchanged; they are now actually tested.
2. **A12 note persistence raced on stale state.** The preceding test leaves its
   own text saved in the same lesson note, so the indicator already read "Saved"
   on arrival; the assertion passed instantly and the reload beat the new write.
   The test now waits for the server to acknowledge *this* write before
   reloading. Stricter, not weaker.

Both were silently passing-or-failing on timing rather than on product
behaviour. This is the same class of problem as the earlier silent `test.skip`.

## Defect 5 — the practice client reads a CSRF token that nothing ever writes

**Severity: high. No attempt, reveal, or draft save can succeed.**

`apps/web/src/features/practice/api.ts:27-32`

    function csrfToken(): string {
      // The shell stores the token issued by /auth/me in a meta tag ...
      const meta = document.querySelector('meta[name="dp-csrf-token"]');
      return meta?.getAttribute('content') ?? '';
    }

`meta[name="dp-csrf-token"]` appears in exactly one place in the repository —
the line above, which reads it. Nothing creates it: not `index.html`, not the
shell, not the API. The shell keeps the token in a module variable and already
exports an accessor, `getCsrfToken()` in `apps/web/src/lib/api.ts:58`.

So the practice client always sends an empty token and the server rejects it.
Observed directly: `POST /api/v1/attempts` -> **403**, twice, once per run.

This affects every write in the practice feature — attempts, hint and solution
reveals, and draft saves (four call sites).

The fix spans the practice feature and the shell, so it was not made here. The
obvious shape is for the practice client to call the shell's `getCsrfToken()`
rather than invent a second, unimplemented transport for the same value.

## Question 5 — browser exercise attempt: still not closed

This was the last gap in the runner's verification, which has only ever executed
under Node. It is now much closer but still open.

What DOES work in a real browser, confirmed this pass: the practice panel
renders, a choice exercise shows its four options, hints and "Reveal solution"
are present, an option can be selected and "Check answer" clicked. The panel and
its renderers are sound.

What fails: the submission itself, on defect 5, with a 403. So the QuickJS
worker transport — real `Worker` construction and WASM instantiation in a
browser — is **still unproven**. A choice exercise does not exercise the runner
anyway; once defect 5 is fixed, the attempt test should be pointed at a
`function` exercise, which is what actually drives QuickJS.

## Question 5 (the coordinator's) — `localOnly` is unreachable in this release

Verified rather than assumed. The V1 release contains **no** local-project
exercises at all. Exercise types across the whole release:

    choice 10, explanation 24, code-reading 35, function 33, predict-output 6

and grading kinds `choice 45, rubric 24, function-cases 33, predict-output 6`.
The content validator's own inventory agrees: `local 0`.

So `ExercisePanel`'s `exercise.localOnly` branch cannot be reached by any
shipped content, and there is nothing to render badly today. The mismatch is
real but **latent**: the API never emits `localOnly`, so the first time a
`type: 'local-project'` exercise is authored, it will render with no explanation
and no mission link, silently losing the spec 3.3 / 4.3 affordance. Worth fixing
before that content exists, not after. Not fixed here — it spans two owners.

---

# Fifth pass — after defect 5 (practice CSRF) was fixed

Two full runs, plus the browser-runner work.

| Test | Run A | Run B |
|---|---|---|
| setup + shell (6) | pass | pass |
| A12 no horizontal scroll at 360px | pass | pass |
| A12 nav reachable / touch targets | pass | pass |
| A12 lesson tabs preserve typed input | pass | pass |
| A12 note reports Saved only after ack | pass | pass |
| A14 failed save keeps text, shows Unsaved | pass | pass |
| A14 stale write conflicts | pass | pass |
| Browser runner — wrong fails, solution passes, attempt recorded | FAIL | FAIL |
| Browser runner — code draft survives reload (A04 browser half) | FAIL | FAIL |
| **Totals** | **12 passed / 2 failed** | **12 passed / 2 failed** |

Identical totals. **A12 and A14 remain verified.** The two failures are the new
browser-runner tests, and they fail for a real product reason.

## Defect 6 — the code editor renders empty and hidden

`apps/web/src/features/practice/CodeEditor.tsx`

One `hostRef` is attached to BOTH the textarea (fallback branch) and the
CodeMirror host div (enhanced branch). The effect runs while `enhanced` is still
false, so `hostRef.current` is the **textarea**, and it does:

    const created = new EditorView({ state, parent: hostRef.current });
    setEnhanced(true);

A `<textarea>` cannot hold element children, so the view goes nowhere; then
`setEnhanced(true)` swaps in a **fresh, empty** div. Result:

    <div class="_editorHost_…" role="group" aria-label="Code editor for isBlank"></div>

empty, zero-height, `visible=false`. Measured 5 reloads out of 5 on
`/practice/v1-e011`. In other runs the fallback textarea rendered instead and
the editor worked — so which branch wins is a race, and when CodeMirror "wins"
the learner gets no editor at all and no fallback either.

## Defect 7 — the QuickJS runner cannot execute in the browser

**This is the one that matters: it is why the runner has only ever passed under
Node.**

Forcing the documented textarea fallback (by failing the CodeMirror import,
which the component handles explicitly) gives a usable editor with the starter
loaded. Pressing Run then produces, on screen:

    ! The code threw an error
    The exercise runtime stopped unexpectedly. Try running again.

The browser console says exactly why:

    WORKER http://localhost:5173/src/workers/runner.worker.ts?worker_file&type=module
    wasm streaming compile failed: TypeError: Failed to execute 'compile' on
      'WebAssembly': Incorrect response MIME type. Expected 'application/wasm'.
    falling back to ArrayBuffer instantiation
    failed to asynchronously prepare wasm: CompileError:
      WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 64 6f

`3c 21 64 6f` is ASCII `<!do`. The `.wasm` request is being answered with
`index.html` — the SPA fallback — so there is no WebAssembly to compile.

Note what this does and does not implicate:

- The **worker transport is fine**. The `Worker` is constructed and the module
  loads; the worker URL appears in the log.
- The failure is purely **WASM asset resolution**.

`packages/runner/src/worker.ts:30` loads the engine with
`import('quickjs-emscripten').then((m) => m.getQuickJS())`. `getQuickJS()`
resolves the *wasmfile* variant, which fetches a separate `.wasm` at a URL Vite
does not serve. `@jitl/quickjs-wasmfile-release-sync` is already a dependency,
so this is fixable without adding packages — either instantiate the variant with
an explicit Vite-resolved asset URL (`import wasmUrl from '…/…wasm?url'`), or
use a single-file variant that inlines the WebAssembly and needs no asset
resolution at all.

**Consequence:** all 33 `function` exercises and every TypeScript exercise are
currently unrunnable in a browser. The runner's Node verification (63/63) still
stands and the interpreter logic is shared, but the browser path is now
positively known to be broken rather than merely unverified.

## Also observed, not chased

With the run in its error state, **"Submit attempt" was still offered** while
Results read "The code threw an error". Worth checking whether an attempt can be
submitted off a failed run; that would be evidence recorded from a run that
never produced case results.

## Third "asserted but not exercised" finding

Reported per the standing request.

In `a12-mobile-journey`, `fill()` on the note textarea produced
`"a thought I do not want to losedurable note text"` — the previous test's text
with the new text appended, rather than a replacement. The assertion that
followed would have been comparing against a value the test never actually
established. The test now clicks, selects all and types like a person, and
asserts the field holds exactly the new text before proceeding. Whether the
underlying controlled/autosaving textarea can genuinely lose a clear against a
concurrent load is worth a look on the product side.

The result-text pattern in the browser-runner test
(`/failed|not passing|0 of 8|[1-7] of 8/i`) has **never matched real output**,
because the runner has never produced a real result. It is a guess and must be
re-checked against the actual results panel once defect 7 is fixed.

## Still not verified

- A real exercise attempt executed through QuickJS in a browser (defect 7).
- The A04 browser half — code draft written, reloaded, still present (defects 6
  and 7 block reaching a usable editor reliably).
- Any engine other than Chromium.

---

# Final pass — browser runner working

Two full runs against my own API + Vite stack (not the verifying agent's), with
the real published V1 release.

| | Run 1 | Run 2 |
|---|---|---|
| **Result** | **14 passed / 0 failed, exit 0** | **14 passed / 0 failed, exit 0** |

Identical. Nothing flaky, nothing skipped, no `test.skip` in any signed-in path.

**A12 passes. A14 passes. The browser runner passes.**

## The browser runner is verified end to end

On `v1-e011` (`isBlank`, 8 cases) in Chromium, through the real Worker + WASM:

- the deliberately wrong implementation produced
  `Some cases did not pass. 5 of 8 cases passed.` with per-case rows showing
  `EXPECTED false / RECEIVED true`;
- the reference solution produced `All cases passed. 8 of 8 cases passed.`;
- `POST /api/v1/attempts` returned **200**;
- the request carried `gradingOrigin: "browser_automated"`.

Confirmed independently in PostgreSQL rather than from the UI alone:

    {"gradingOrigin":"browser_automated","assistance":"none",...}
    {"gradingOrigin":"browser_automated","assistance":"none",...}
    total v1-e011 attempts: 4

and the `.wasm` asset is now served as `200 application/wasm`.

This closes the last unverified claim in the build. The runner had passed 63/63
under Node while being completely non-functional in a browser; it now executes
in the environment learners actually use.

## A04 browser half — verified

Type into the editor, wait for the server to acknowledge the draft write,
reload: the code comes back. Asserted with a contiguous `DRAFTMARKER…` token
plus a body check for `trim()`, because CodeMirror's gutter interleaves line
numbers into `textContent` (`9123456789>function isBlank…`) and collapses
newlines, which makes multi-line matching fragile. The check still proves both
that the draft persisted and that it is the code that was written.

## Result assertions, now written against real output

The old pattern `/failed|not passing|0 of 8|[1-7] of 8/i` was a guess that had
never matched anything. It now asserts the summaries the UI actually renders:

    /Some cases did not pass\.\s*\d+ of 8 cases passed\./i     (wrong implementation)
    /All cases passed\.\s*8 of 8 cases passed\./i              (reference solution)

plus a per-case `Failed` row on the wrong run. An all-passing run cannot satisfy
the first, and a partially-passing run cannot satisfy the second.

## Fourth "asserted but not exercised" finding — in my own spec, twice

1. **Submit-button visibility proved nothing.** The spec used
   "`Submit attempt` is visible" as evidence the reference solution passed. The
   UI also offers Submit after a *partially failing* run — correctly, since that
   is a legitimate failing attempt. The assertion would have passed on a wrong
   solution. Replaced with the explicit `8 of 8` summary.
2. **The "wrong starter" was not wrong.** The spec trusted whatever the editor
   loaded. Drafts persist per owner, so once any earlier run saved a working
   solution, the "starter" came back correct and the failure path silently
   stopped being tested — which is exactly how it failed in the first run of
   this pass. The spec now sets the known-wrong implementation explicitly before
   running it.

Both are the same failure mode found three times before in other people's
tests: an assertion that cannot fail is worse than no assertion, because it
certifies the untested.

## Environment note

Two orphaned dev servers from the previous verification still held ports 3001
and 5173 and silently answered a readiness probe. They were stopped and the
stack restarted from a known configuration, so these results describe this
agent's own stack rather than an inherited one.

## Still not verified

- Any browser engine other than Chromium (WebKit and Firefox remain unexercised).
