# Traps that already cost hours here

Each of these actually happened during this build. Most were invisible because
something reported success.

## Git operates on the user's HOME directory

`C:\Users\Owner\Desktop\opusboot1` sits inside a stray repo rooted at
`C:\Users\Owner`. Before this repo had its own `.git`, a plain `git add -A` began
staging `Cookies/`, `My Documents/` and `AppData/`.

The project now has its own `.git`, so this is handled — but **always confirm
before staging**:

    git rev-parse --show-toplevel     # must print .../Desktop/opusboot1

There is no global git identity on this box; it is set repo-locally. Do not set
it globally.

## `cmd | tail` reports the PIPE's exit code

    pnpm install 2>&1 | tail -30      # exit code is tail's, ALWAYS 0

This is how a **failed** install (`ERR_PNPM_EBUSY`) was reported to the user as
"exit 0". It happened twice, with two different commands.

    pnpm install > /tmp/install.log 2>&1; echo "EXIT=$?"      # correct
    cmd | tail; echo "${PIPESTATUS[0]}"                        # also correct

Never pipe a command whose exit code matters.

## Tests that assert behaviour they never exercise

Four instances in this repo. All were green. All certified nothing:

1. A helper returned `null` with `test.skip` when navigation was missing —
   turning a **crash on every chapter page** into a green run.
2. An A14 route glob `'**/api/v1/notes**'` did not match `/api/v1/notes/<id>`, so
   the "network failure" test never failed a request. The alert it asserted had
   **never once fired**.
3. `fill()` on a textarea appended to the prior test's text, so the next
   assertion compared against a value the test never established.
4. A browser-runner spec used "Submit button visible" as proof a solution
   passed — but the UI also offers Submit after a partial failure, so it would
   have passed on a wrong solution. The same spec trusted whatever code loaded as
   "the wrong starter", but drafts persist, so once a correct solution was saved
   the failure path silently stopped being tested.

**Make tests fail loudly. A silent skip is worse than no test.**

## The same string defined in two places

The CSRF header name was `x-devpractice-csrf` in the API and `x-csrf-token` in the
web client. **Every write in the product 403'd** while reads worked. Both test
suites were green — each asserted its own copy of the string, so neither could
ever detect the disagreement.

It is now `CSRF_HEADER` in `@devpractice/contracts`, imported by the API plugin,
web client, practice client, publish script, log redaction and both test suites.
Keep it that way. If you find another duplicated constant across the
client/server boundary, move it to `contracts`.

## Silent fallbacks

`content-tools` imported `createNodeRunner`; the runner exports `runInNode`. The
failed import was swallowed by a bare `catch`, so **every content verification
silently ran on a `node:vm` fallback instead of the QuickJS engine learners
meet.** Three agents found it independently.

It now throws/warns loudly. When you see a `catch` that degrades capability,
check whether it can hide a wrong answer.

## Transaction budgets

Publication did three round-trips per item inside one transaction and blew
Prisma's **5-second default** at 11 fixture items. A real release is ~244 items,
so publishing could never have worked in production while every test passed on
toy data. Fixed with batched `createMany` and an explicit budget
(`TX_OPTIONS`, 30s in `curriculum/shared.ts`).

When a transaction loops over content, check it against a REAL release size.

## WASM served as HTML

QuickJS's `.wasm` was answered with `index.html` by the SPA fallback:

    expected magic word 00 61 73 6d, found 3c 21 64 6f     # "<!do"

All 33 function exercises were unrunnable in a browser while Node showed 63/63.
Fixed via `newVariant(releaseSyncVariant, { wasmLocation: wasmUrl })` with
`import wasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url'`.

Also: Vite defaults workers to `iife`, which cannot code-split the QuickJS
worker — the web app had never successfully built until that was changed.

## A green readiness probe answered by the wrong process

Orphaned dev servers held ports 3001/5173 and answered a health check while the
intended server had failed to start with "port in use". Check the process, not
just the port.

## Content authoring traps

- `runner.unsupported-api` rejects the bare words `document`, `window`, `process`
  and `fetch` in starter or solution code — including `window` as a variable name.
- The `debuggingOrCodeReview` tally matches `type === 'code-reading'` or a title
  regex whose `\b(diagnos|debug)\b` does not match "diagnose" or "debugging".
  Set `type: 'code-reading'` to count reliably.
- `prose.placeholder` matches `/\bplaceholder\b/i` regardless of meaning, which
  makes it awkward to teach that the `placeholder` attribute is not a label.
- Lessons need `bodyMarkdown` **in addition to** `workedExampleMarkdown` and
  `summaryMarkdown`.
- `prose.duplicate` only fires when chapters are assembled together — per-chapter
  validation cannot catch it.
- The scratchpad is shared across parallel agents; unique temp filenames matter.

## Equivalent mutants are real

A surviving mutant is a prompt to inspect the cases, not proof of a defect. Where
widening `<` to `<=` cannot change behaviour on any input, no test can kill it.
Verify by running the mutated source. Then either remove an **incidental**
mutation site, or document it — but do NOT rewrite a solution to silence a
warning when the construct is what the lesson teaches. Precedent and reasoning
are in `docs/known-limitations.md`.
