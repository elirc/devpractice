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

## A reset that misses one table makes a suite pass only once

M07's `resetDatabase()` cleared five tables and left `IdempotencyRecord` alone.
The first `check:baseline` run on a fresh database passed; the second failed on
its own fixture row, with a unique-violation pointing at the test's own setup
line. It looked exactly like a broken reference solution.

When you add a model to a mission's schema, add it to the reset in the same
commit, and **run the baseline twice**. Compare the models in
`prisma/schema.prisma` against the tables the reset deletes; that comparison takes
a minute and is the whole check.

## `dotnet build` needs a project or solution in the CURRENT directory

All four .NET mission starters held two or three sibling project directories and
no `.sln`. The .NET CLI does not search subdirectories, so every `dotnet build`
and `dotnet test` the mission text documented failed with "no project or solution
file found" — the missions could not be run at all. A solution file per starter
fixed it. If you add a .NET mission, add its `.sln`.

## The reachability edges that no tool used to check

Two content mistakes validated green and were invisible until someone opened the
app: a chapter that the release's track item does not list in `chapterIds`, and a
mission that no chapter lists in `missionIds`. The validator walked references
forwards only. Both shipped broken once, affecting 18 chapters and 9 missions.

They are now errors — `reachability.chapter-unlisted` and
`reachability.mission-unclaimed` — with a fixture each. The remaining judgement a
tool cannot make is whether a mission sits on the RIGHT chapter.

## Over-length strings are the common authoring error

Two of 27 new content items were rejected, both for the same reason: a
`baselineChecks` entry over the 300-character cap. The schema caps are in
`packages/contracts/src/content.ts` and worth checking before a long validate run
rather than after: 300 for baseline checks and verification commands, 500 for
acceptance criteria and rubric lines, 1000 per hint, 300 per checklist label.

## `--no-build` after restoring a starter runs the SOLUTION

The A13 flow for a .NET mission builds the starter, checks it, copies the
reference solution over the starter file, rebuilds, checks again, then restores
the starter **source**. It does not rebuild afterwards. So the source on disk is
the starter while `tests/*/bin/Debug/net10.0/*.dll` is still the solution.

A later `dotnet test --no-build` then runs the solution's code and reports a
confident, meaningless pass. This happened here, and the pass looked exactly like
a starter that had stopped failing.

Rebuild before you believe any re-run, and leave each mission rebuilt against its
starter when you are done.

## The global body limit made a real release impossible to import

`app.ts` set `bodyLimit: 1_048_576` with the comment "content import raises its
own limit". It did not. The import route had an application-level
`MAX_PACKAGE_BYTES` of 10 MiB but no route-level `bodyLimit`, so Fastify rejected
the body before the handler ever ran — and because it drops the connection rather
than answering, the publish script saw only:

    Signed in. Active release: ...
    fetch failed

V1's package is 1.09 MB, so this was invisible until a real V2 package (1.9 MB)
was published for the first time. Fixed with
`app.post('/content/imports', { bodyLimit: MAX_PACKAGE_BYTES }, ...)`.

Two lessons, both of which have now bitten this repo twice. A comment asserting
that something is configured elsewhere is not configuration. And a limit sized
against V1's data could never have worked on a real release — the same shape as
the transaction-budget defect above.
