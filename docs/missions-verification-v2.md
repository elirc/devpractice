# Mission verification record — A13, V2 missions (M04–M08)

Acceptance A13 (spec §14.2): in a fresh environment the starter installs,
baseline checks pass, mission checks fail **for the intended reason**, and the
reference solution passes both.

Verified 2026-09-10. Every number below is captured from a real run on this
machine. Nothing here is inferred from the presence of a file.

## Environment

Docker does not start on this machine, so these missions do not use a container.
Each one owns two databases on the hand-started PostgreSQL 18 at
`127.0.0.1:5440`:

| Databases | Mission |
| --- | --- |
| `m04_search`, `m04_search_test` | M04 |
| `m05_nplus1`, `m05_nplus1_test` | M05 |
| `m06_inventory`, `m06_inventory_test` | M06 |
| `m07_inventory`, `m07_inventory_test` | M07 |
| `m08_inventory`, `m08_inventory_test` | M08 |

All ten are separate from the platform's `devpractice` / `devpractice_test`
(spec §5.2): a learner's deliberately broken query cannot reach platform
learning records.

**Every database in this table was dropped and recreated empty before its
mission was verified**, so "migrations apply to an empty database" is a result
rather than an assumption. `TEST_DATABASE_URL` was migrated separately from
`DATABASE_URL` in each case.

`src/db.ts` in all five starters already selects `TEST_DATABASE_URL` under a test
run (`VITEST` set, or `NODE_ENV=test`). The M02/M03 defect recorded in
`missions-verification.md`, where the route under test read the development
database while the helper seeded the test database, is **not** present in any of
these five. That was checked by reading all five files, not assumed.

## What was built during this verification

M08 was abandoned mid-edit by an earlier session and was not a runnable mission:
`src/jobs/report.ts`, `src/routes/reports.ts`, `src/jobs/run.ts`,
`tests/baseline.test.ts`, `tests/mission.test.ts`, the reference solution and
both READMEs did not exist, and `src/routes/inventory.ts` carried a header
describing itself as M06's reference solution. All of that was written, and then
A13 was run against it like any other mission.

M04's starter also shipped a stale `docker-compose.yml` copied from M02: it named
M02's container, created a `supportdesk` database with a `supportdesk` role, and
published port 5441, while M04's `.env.example` points at `m04_search` on 5440
with the `postgres` role. A learner following it would have brought up a database
the application could not use. It was removed rather than repaired, because the
docker path cannot be verified on this machine and an unverifiable instruction is
worse than none.

## M04 — search and stable cursor pagination — A13 VERIFIED

| Stage | Command | Result |
| --- | --- | --- |
| Migrate empty DB | `prisma migrate deploy` ×2 targets | `20260910000634_init` applied, exit 0 both |
| Seed repeatable | `tsx prisma/seed.ts` ×2 | `{ users: 2, tickets: 5, comments: 3 }` both times |
| Baseline (starter) | `npm run check:baseline` | **9/9 passed**, exit 0 |
| Mission (starter) | `npm run check:mission` | **10 failed / 1 passed**, exit 1 |
| Baseline (solution) | `npm run check:baseline` | **9/9 passed**, exit 0 |
| Mission (solution) | `npm run check:mission` | **11/11 passed**, exit 0 |

Intended reason confirmed: every failure is an `AssertionError` about search
results, not an environment error. Examples —
`expect(ids.every(id => SEARCH_MATCHES.includes(id))).toBe(true)` received
`false` at `tests/mission.test.ts:141`, because `GET /tickets` ignores `q` and
returns every ticket.

The one starter test that passes is "an empty q behaves like no search at all",
which a route ignoring `q` entirely satisfies by accident. That is expected and
is not evidence of a weak check.

## M05 — the N+1 investigation — A13 VERIFIED

| Stage | Command | Result |
| --- | --- | --- |
| Migrate empty DB | `prisma migrate deploy` ×2 targets | exit 0 both |
| Seed repeatable | `tsx prisma/seed.ts` ×2 | `{ users: 2, tickets: 5, comments: 3 }` both times |
| Baseline (starter) | `npm run check:baseline` | **6/6 passed**, exit 0 |
| Mission (starter) | `npm run check:mission` | **2 failed / 5 passed**, exit 1 |
| Typecheck (solution) | `tsc --noEmit` | exit 0 |
| Baseline (solution) | `npm run check:baseline` | **6/6 passed**, exit 0 |
| Mission (solution) | `npm run check:mission` | **7/7 passed**, exit 0 |

Intended reason confirmed, with measurements rather than adjectives:

```
20 tickets took 41 queries and 4 took 9. The count must not scale with the page.
Expected at most 3 queries for a page of 20; measured 41.
```

Only two checks fail because this starter is **correct and slow**: the five
behaviour checks pass before and after, which is what catches a "faster"
solution that quietly changes the answer. The suite also guards its own
instrument — "the starter really is N+1, so this suite is measuring something"
asserts the recorder observed a non-zero count, so the other assertions cannot
pass vacuously.

## M06 — inventory core and its invariants — A13 VERIFIED

| Stage | Command | Result |
| --- | --- | --- |
| Migrate empty DB | `prisma migrate deploy` ×2 targets | `20260910181540_init` applied, exit 0 both |
| Seed repeatable | `tsx prisma/seed.ts` ×2 | `{ users: 2, products: 5, movements: 4 }` both times |
| Baseline (starter) | `npm run check:baseline` | **7/7 passed**, exit 0 |
| Mission (starter) | `npm run check:mission` | **15 failed / 0 passed**, exit 1 |
| Typecheck (solution) | `tsc --noEmit` | exit 0 |
| Baseline (solution) | `npm run check:baseline` | **7/7 passed**, exit 0 |
| Mission (solution) | `npm run check:mission` | **15/15 passed**, exit 0 |

Intended reason confirmed: the failures read `expected 501 to be 400`,
`expected 501 to be 404`, `expected 501 to be 409`, and one
`TypeError: Cannot read properties of undefined (reading 'id')` from a test that
tried to use the id of a record the stub never created. All of them are the
`NOT_IMPLEMENTED` stub, which is the assignment.

## M07 — duplicate order submission — A13 VERIFIED

### A defect found and fixed first: the baseline was not repeatable

On the first A13 pass the reference solution failed a BASELINE check, which would
ordinarily mean the solution was wrong. It was not. `tests/helpers.ts` had a
`resetDatabase()` that cleared five tables and left `IdempotencyRecord` alone, so
the fixture row written by "the database refuses two records with the same
(owner, operation, key)" survived between runs. On the next run the FIRST insert
was refused instead of the second, and the check failed with
`Unique constraint failed on the fields: (ownerId, operation, key)` pointing at
line 38 of the baseline file — its own setup line.

This would have hit any learner who ran `npm run check:baseline` twice, and it
would have looked like their code. One line was added to `resetDatabase()`. That
is harness infrastructure: `src/routes/inventory.ts`, the file a learner edits, is
untouched, and no assertion was changed or removed — the check now actually
exercises what it claims, which it could not do on a second run.

All five V2 starters were then checked for the same class of defect by comparing
every model in `prisma/schema.prisma` against the tables `resetDatabase()`
deletes. M07 was the only gap.

### Results after the fix

| Stage | Command | Result |
| --- | --- | --- |
| Migrate empty DB | `prisma migrate deploy` ×2 targets | `20260910181509_init` applied, exit 0 both |
| Seed repeatable | `tsx prisma/seed.ts` ×2 | `{ users: 2, products: 5, movements: 4 }` both times |
| Baseline (starter), run 1 | `npm run check:baseline` | **9/9 passed**, exit 0 |
| Baseline (starter), run 2 | `npm run check:baseline` | **9/9 passed**, exit 0 — repeatable |
| Mission (starter) | `npm run check:mission` | **5 failed / 4 passed**, exit 1 |
| Typecheck (solution) | `tsc --noEmit` | exit 0 |
| Baseline (solution) | `npm run check:baseline` | **9/9 passed**, exit 0 |
| Mission (solution) | `npm run check:mission` | **9/9 passed**, exit 0 |

Intended reason confirmed, and the two mission-specific proofs A13 requires for
this mission both ran against real behaviour:

```
expected 201 to be 200                     # a replay must not be a creation
the same order id must come back: expected '0c3ce1a2-…' to be '0b00143c-…'
expected 31 to be 37                       # stock moved twice
concurrent duplicates produced 2 orders (statuses 201, 201): expected 2 to be 1
expected 201 to be 409                     # same key, different body
```

The concurrent case is the one that matters: two submissions issued together with
`Promise.all` produced two orders on the starter and one on the solution. A fix
that only worked when the retry arrived later would have been caught here.

## M08 — retryable report job — A13 VERIFIED

| Stage | Command | Result |
| --- | --- | --- |
| Migrate empty DB | `prisma migrate deploy` ×2 targets | `20260910181507_init` applied, exit 0 both |
| Seed repeatable | `tsx prisma/seed.ts` ×2 | `{ users: 2, products: 5, movements: 4 }` both times |
| Baseline (starter) | `npm run check:baseline` | **12/12 passed**, exit 0 |
| Mission (starter) | `npm run check:mission` | **10 failed / 6 passed**, exit 1 |
| Typecheck (solution) | `tsc --noEmit` | exit 0 |
| Baseline (solution) | `npm run check:baseline` | **12/12 passed**, exit 0 |
| Mission (solution) | `npm run check:mission` | **16/16 passed**, exit 0 |

Intended reason confirmed. Sample failures:

```
a job out of attempts must not be picked up again: expected 'succeeded' to be 'skipped'
got failed and succeeded: expected [ 'failed', 'succeeded' ] to deeply equal [ 'skipped', 'succeeded' ]
expected 2 to be 1
```

The six checks that pass on the starter are the guards and the two criteria the
starter already happens to meet: it does interrupt when the failure is injected,
it does record `lastError`, it does count two attempts, and an exhausted job does
keep what it committed. Keeping them in the mission suite is deliberate — the
first is an instrument check, and without it a run that never interrupted would
make every resume assertion pass for the wrong reason.

### The delivery guarantee, stated

M08's solution makes the committed **effect** exactly once: one `ReportLine` per
`(jobId, productId)`, however many invocations it takes. The **invocation** is
at-least-once and cannot be made otherwise. Both the mission text and the
reference solution's header say so explicitly, because an undefined
"exactly-once" is how a team ends up believing a guarantee nobody implemented.

### The failure mode M08 does not handle

A process that dies while holding a claim leaves its job on `running`, and
nothing reclaims it. Recovering that needs a lease with an expiry and a
heartbeat. The stuck job was chosen over reclaiming on a timeout because a job
that needs a human is visible, whereas a timeout set too short puts two workers
on one job — the defect the mission exists to fix. This is documented in the
solution, the README and the mission item rather than left for a learner to
discover.

## Not verified

- The `docker compose` path in any V2 mission. Docker does not start here.
- Any V2 mission under concurrent load beyond the two-request cases the checks
  construct.
- M05's solution on a table large enough for the query plan to matter; the
  mission's own solution notes say a trigram or full-text index is the honest
  next step for M04's search, and that is unmeasured.
