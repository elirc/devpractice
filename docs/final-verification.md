# V1 final verification record

Every number here was produced by running the command on this machine. Where a
gate was not run, it says so. Nothing in this file is inferred.

Machine: Windows 11, Node 22.16.0, pnpm 9.12.3, PostgreSQL 18 on 127.0.0.1:5440.
Docker is **broken** on this box (`Docker Desktop is unable to start`), so the
documented `docker compose up -d db` path is **unverified**; a hand-started
PostgreSQL cluster at `C:\Users\Owner\pgdata-devpractice` was used instead.

## Gate results

| Gate | Command | Result |
|---|---|---|
| Content release | `content-tools … cli.ts validate` | **OK**, exit 0 |
| Typecheck ×6 packages | `tsc --noEmit` | **0 errors** in all six |
| learning-core unit | `vitest run` | **59/59** |
| runner unit | `vitest run` | **63/63** |
| content-tools unit | `vitest run` | **19/19** |
| web unit | `vitest run` | **33/33** |
| API foundation integration | `vitest run --config vitest.integration.config.ts` | **23/23** |
| API learning integration | `vitest run --config tests/learning/vitest.config.ts` | **45/45**, exit 0 |
| e2e (A12, A14, browser runner) | `playwright test` | **14/14**, `PW_EXIT=0`, twice |

## Content inventory (validator-reported)

    tracks 1  chapters 12  lessons 36
    lesson exercises 108  review cards 72
    assessments 12  placement items 60  missions 3
    diversity: runnable 32, debugging/review 39, rubric 24, choice 46, predict 6

Matches the section 2.2 / section 11 V1 requirement exactly. Diversity clears the
section 11.4 minimums (>=20 runnable, >=24 debugging/review, >=12 rubric).

Behavioural verification runs on the **QuickJS** backend — the same interpreter
the learner meets:

    Solution verification (backend: quickjs (@devpractice/runner))
      exercises checked 33 · solutions passing 33/33
      starters failing as expected 33/33
      wrong implementations rejected 212, wrongly accepted 2

The 2 survivors are documented equivalent mutants — see known-limitations.md.

## Acceptance scenarios

Verified by execution: A01, A02, A03, A04, A05, A06, A07, A08, A09, A10, A11,
A12, A13 (all three missions), A14, A16, A17, A18.

A15 (export + database restore into a clean environment) is **NOT verified** —
the export endpoint works and is covered by integration tests, but a full backup
restore drill was never performed.

## Known-flaky under load

The API integration suites open many Prisma clients. Under memory pressure
(~1.9 GB free, with unrelated applications running) they fail with
`PrismaClientInitializationError` — 8 to 14 failures, varying per run. The same
tests pass individually and the full suite returns **45/45** once memory frees
up. This is environmental, not a code defect, but it means a red run on a loaded
machine should be re-run before it is believed.

`tests/learning/` and `tests/foundation/` share one database and **cannot run
concurrently** — each truncates the other's fixtures. The `test:integration`
script chains them sequentially, which is safe; any parallel invocation produces
phantom failures. A per-suite database would remove the trap.

## Operational notes worth keeping

- A **green readiness probe can be answered by the wrong process.** Orphaned dev
  servers held ports 3001/5173 and answered a health check while the intended
  server had failed to start with "port in use". Check the process, not just the
  port.
- Two synthetic accounts exist in the development database from verification:
  `e2e-runner@devpractice.test` and `runner-verify@devpractice.test`. They are
  dev-database artifacts only. `owner:bootstrap` refuses to create a second
  owner unless `ALLOW_ADDITIONAL_OWNERS=true` is set explicitly.
- Mission `node_modules` under `projects/` were left in place after A13
  verification; removal commands are in `missions-verification.md`.

## Not verified

- **Any browser engine other than Chromium.** WebKit and Firefox were never
  exercised, in the runner or in e2e.
- **A15** backup/restore drill.
- The `docker compose` local-development path.
- Per-exercise browser coverage: one JavaScript and one TypeScript exercise were
  driven end to end in Chromium, not all 33.
- The QuickJS `JS_FreeRuntime` stack-overflow abort and its drop-the-worker
  mitigation were reproduced under Node only, never in a browser.
