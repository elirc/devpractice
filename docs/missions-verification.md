# Mission verification record — A13

Acceptance A13 (spec §14.2): in a fresh environment the starter installs,
baseline checks pass, mission checks fail **for the intended reason**, and the
reference solution passes both.

Verified 2026-09-09. Every result below is captured from a real run.

## Environment substitution

The mission READMEs document `docker compose up -d db` (PostgreSQL on 5441).
**Docker Desktop does not start on this machine**, so verification used the
hand-started PostgreSQL 18 already listening on `127.0.0.1:5440`, with
dedicated databases created for the missions:

| Database | Used by |
| --- | --- |
| `supportdesk`, `supportdesk_test` | M02 |
| `ownership`, `ownership_test` | M03 |

These are **separate databases from the platform's** `devpractice` /
`devpractice_test` (spec §5.2): a learner's intentionally broken query cannot
reach platform learning records. The docker-compose path in the READMEs remains
unverified on this machine.

## Defect found and fixed: tests ran against the wrong database

Both starters had `src/db.ts` as:

```ts
export const prisma = new PrismaClient();
```

That reads `DATABASE_URL`, while `tests/helpers.ts` connects explicitly to
`TEST_DATABASE_URL`. The consequence was not cosmetic:

- the test helper truncated and seeded the **test** database, while the route
  under test read and wrote the **development** database;
- fixtures created by a test were invisible to the endpoint being tested;
- a test run would silently wipe development data.

This made the reference solution fail 6 of 12 mission checks — a correct
implementation looked broken. Symptom: `expected [ { id: 'seed-t-4', … } ] to
deeply equal []`, i.e. the endpoint returned seeded development rows where the
test had just emptied the test database.

`src/db.ts` in both starters now selects `TEST_DATABASE_URL` under a test run
(`VITEST` set, or `NODE_ENV=test`). This is harness infrastructure, not the
assignment: `routes/tickets.ts` — the file the learner edits — is untouched, and
no test assertion, route path or filename referenced by curriculum chapters
10–12 was changed.

After the fix the starter still fails exactly as before (10 failed / 2 passed),
so the fix did not mask the assignment.

## M02 — persistent ticket API — A13 VERIFIED

| Stage | Command | Result |
| --- | --- | --- |
| Install | `npm install` | exit 0, 90 packages |
| Migrate empty DB | `prisma migrate dev --name init` | `20260910000634_init`, "in sync" |
| Seed repeatable | `npm run db:seed` ×2 | `{ users: 2, tickets: 5, comments: 3 }` both times; DB after two runs: tickets 5, comments 3, users 2 — no duplicates |
| Baseline | `npm run check:baseline` | **4/4 passed**, exit 0 |
| Mission (starter) | `npm run check:mission` | **10 failed / 2 passed**, exit 1 |
| Mission (starter, after db.ts fix) | `npm run check:mission` | **10 failed / 2 passed**, exit 1 — unchanged |
| Baseline (solution) | `npm run check:baseline` | **4/4 passed**, exit 0 |
| Mission (solution) | `npm run check:mission` | **12/12 passed**, exit 0 |

Failure reasons on the starter were `501` (the `NOT_IMPLEMENTED` stub) and `404`
(the `/tickets/:id` routes are not registered yet) — the intended reasons. No
timeouts, no missing dependencies, no connection errors.

### Caveat: two mission checks pass vacuously on the starter

`GET /tickets/:id > returns 404 for an unknown id` and one comments check pass
against the untouched starter, because the starter registers no route and
Fastify answers 404 anyway. They assert the right behaviour for a finished
implementation but do not discriminate on day one. Not fixed here — changing
those assertions would diverge from the tests curriculum chapter 10 quotes.
Worth tightening in a later content pass.

### Migrations are generated, not committed

`starter/prisma/` ships a schema but no `migrations/` directory; the documented
`npm run db:migrate` (`prisma migrate dev --name init`) creates it on first run.
This works and the README is accurate, but the applied SQL is not pinned in the
starter, so two learners can generate migrations at different Prisma versions.
Committing the initial migration would make the starter more reproducible.

## M03 — ownership defect and regression — A13 VERIFIED

| Stage | Command | Result |
| --- | --- | --- |
| Install | `npm install` | exit 0 |
| Migrate empty DB | `prisma migrate dev --name init` + `migrate deploy` on the test DB | "in sync"; "All migrations have been successfully applied" |
| Seed repeatable | `npm run db:seed` ×2 | `{ users: 2, tickets: 5, comments: 3 }` both times |
| Baseline | `npm run check:baseline` | exit 0 |
| Security (starter) | `npm run check:mission` | **7 failed / 4 passed**, exit 1 |
| Baseline (solution) | `npm run check:baseline` | exit 0 |
| Security (solution) | `npm run check:mission` | **11/11 passed**, exit 0 |

### The planted defects are genuinely present

Confirmed by reading `starter/src/routes/tickets.ts` and by the failures:

1. `GET /tickets/:id` — unscoped `findUnique`, returns any owner's ticket
   including `include: { owner: true }`.
2. `PATCH /tickets/:id` — checks ownership but the 403 body names
   `existing.owner.displayName` and `existing.customerName`, leaking data from
   the record it just refused, and answers 403 where the documented policy is
   404.
3. `GET /tickets/:id/comments` — unscoped; any user reads any ticket's comments.
4. `POST /tickets/:id/comments` — unscoped; any user comments on any ticket.

### The deliberate inconsistency is preserved

The 4 tests that pass on the untouched starter are the behaviours that are
already **correct**: the owner can still read their own ticket, the owner can
still read and write their own comments, `GET /tickets` is properly
owner-scoped, and that scoping cannot be widened with a crafted cursor. A
codebase where one route is scoped and the neighbouring one is not is exactly
what this mission is teaching the learner to notice.

The reference fix is a real repair, not a cosmetic one: ownership moves into the
query (`findFirst({ where: { id, ownerId } })`), every inaccessible resource
answers 404, and no refusal echoes data from the refused record.

## Disk and cleanup

Free space on C: was **32 GB before** and **31 GB after** — the parent's ~4 GB
estimate was stale. Both mission `node_modules` trees (and the generated Prisma
clients) were **left in place**, because removing them would force a slow
re-download before the next run and space is not scarce. Remove with:

```bash
rm -rf projects/m02-support-desk-api/starter/node_modules
rm -rf projects/m03-ownership-defect/starter/node_modules
```

The generated `.env` files in both starters point at 127.0.0.1:5440 and contain
no credentials (trust auth, local only). `starterCommit` remains `null` in both
missions — no commit hash was invented.
