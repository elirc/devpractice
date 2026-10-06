# Codebase tour

Where things live, how a request travels, and where to make common changes.
Line numbers are as of commit `1c391f5`.

## Layout

```
apps/
  api/            Fastify service: auth, content publication, learning records
    src/
      app.ts          buildApp(): plugins + routes, no listen (tests call app.inject)
      server.ts       builds the app and calls listen
      config.ts       environment parsing, session lifetimes
      plugins/        auth (session cookie -> request.owner), csrf, error handler, request logging
      lib/            errors, idempotency receipts, xp, activity, clock, deps, pagination, tokens
      db/client.ts    the one Prisma client
      modules/        one folder per feature, each exporting registerXRoutes
      scripts/        owner bootstrap, password reset, seed, prune, publish-release
  web/            React + Vite single-page app
    src/
      App.tsx         routing
      features/       one folder per screen (learn, practice, review, today, projects, ...)
      features/practice/  editor, runner hook, exercise renderers
      workers/        runner.worker.ts, the Web Worker entry
      lib/api.ts      typed fetch client (envelope, CSRF, clientEventId)
      lib/queries.ts  TanStack Query hooks for every read and mutation
      styles/         tokens.css + global.css
packages/
  contracts/      zod schemas + DTOs shared by web, api and tooling
  learning-core/  PURE rules: scheduling, evidence, XP, placement, content diff
  runner/         QuickJS-WASM bounded execution, browser worker + Node twin
  content-tools/  validation + snapshot build CLI (dp-content)
prisma/           platform schema and migrations
curriculum/       authored content, concept catalog, release manifests, fixtures
projects/         runnable learning repositories: M01-M08 (TypeScript), M09-M12 (.NET)
docs/             this documentation
handoff/          session handoff notes (state, outstanding work, environment)
```

## Module boundaries that matter

**`learning-core` has no I/O.** Scheduling, evidence classification, XP and
placement rules are pure functions with an injected clock
(`packages/learning-core/src/clock.ts`). This is what makes them testable without
a database, and it is why the rules can be read in one place rather than being
scattered through route handlers. [learning-algorithms.md](learning-algorithms.md)
walks through each rule.

**`contracts` is the only shared vocabulary.** If web and api disagree about a
shape, the fix belongs there, not in a cast on one side. Constants such as XP
amounts and review intervals also live there (`packages/contracts/src/domain.ts`).

**`runner` is used twice.** The browser runs it in a Web Worker; the content
CLI runs the Node twin (`packages/runner/src/node-runner.ts`). Same engine
(`engine.ts`), same comparison logic (`compare.ts`) — so an exercise verified at
build time grades identically for the learner.

**The platform database is separate from every learning-project database.** A
beginner's intentionally broken query in M02 cannot reach learning records.

## How a lesson completion travels

1. **Web.** `LessonPage.tsx:284-289` renders "Mark lesson complete", disabled
   while the mutation is pending. `useCompleteLesson`
   (`apps/web/src/lib/queries.ts:146-162`) POSTs
   `{ clientEventId: newClientEventId(), acknowledgedReading: true }` to
   `/api/v1/lessons/:id/complete`, then invalidates the lesson, curriculum,
   progress, and today queries.
2. **App.** `buildApp` (`apps/api/src/app.ts:31-73`) caps bodies at 1 MiB (line 47),
   registers the auth, CSRF, and error plugins, then mounts every module from
   `modules/index.ts` under `/api/v1` (lines 63-70).
3. **Plugins.** The auth hook (`plugins/auth.ts:93-97`) resolves the session
   cookie into `request.owner`. The CSRF hook (`plugins/csrf.ts:66-81`) skips
   safe methods, requires an `Origin` (or `Referer`) equal to `APP_ORIGIN`, and
   compares the CSRF header with a token derived from the session's secret using a
   constant-time comparison.
4. **Route, outside the transaction** (`modules/lessons/routes.ts:118-159`).
   `requireOwner`, zod-parse params and body, resolve the active release, load the
   lesson and its required exercises, fetch the owner's attempts, and run
   `checkLessonCompletion`. A missing requirement is a `400` listing the
   outstanding exercise ids.
5. **Service, in one transaction** (lines 161-211):
   `findReceipt` (replay? return the stored response) →
   upsert `LessonProgress` through `nextLessonStatus` (monotonic) →
   `grantXp` with key `lesson:<id>` →
   `recordActivity('lesson.completed')` →
   `storeReceipt`.
6. **Response.** `{ data: { lessonId, status, completedAt, xpAwarded } }`. A retry
   with the same `clientEventId` and body returns this identical response and
   awards nothing further; the same id with a different body is
   `409 IDEMPOTENCY_CONFLICT` (`apps/api/src/lib/idempotency.ts:37-52`).

The transaction boundary is the point: a crash midway leaves neither the
completion nor the receipt, so the retry genuinely redoes the work. Note that
step 4's reads happen **before** the transaction. They only decide whether the
request is allowed; nothing written in step 5 depends on them.

## How a browser exercise runs

1. `useRunner` (`apps/web/src/features/practice/useRunner.ts`) creates a `runId`
   and hands the request to the runner client.
2. The client (`packages/runner/src/client.ts`) owns one Web Worker
   (`apps/web/src/workers/runner.worker.ts`) and arms a watchdog for
   `2 × timeoutMs + 1000` ms (lines 195-212). If the worker never answers, it is
   terminated and the run reports `timed_out`.
3. Inside the worker, messages over 1 MiB are rejected
   (`packages/runner/src/worker.ts:24,77`).
4. `engine.ts` creates a fresh QuickJS runtime per run with a memory ceiling and
   a stack limit (lines 175-177), installs a bounded console, evaluates a trusted
   prelude that captures `JSON` and `Function.prototype.apply` before learner code
   runs, and only then starts the learner's clock (line 196). The interrupt
   handler stops execution once `now() > deadline`.
5. Expected values and comparison stay in the host (`compare.ts`); learner code
   only ever sees copied JSON inputs.

Default limits (`packages/contracts/src/runner.ts:14-28`): 2 s per run, 10 s for
first-time WASM and compiler start-up, 64 KiB source, 25 cases, 64 KiB input and
output, 100 console lines / 16 KiB, 32 MiB memory, 512 KiB stack.

## Where to change common things

| Change | Where |
| --- | --- |
| Review intervals or evidence thresholds | `packages/learning-core/src/` and the constants in `packages/contracts/src/domain.ts` |
| A new API endpoint | new folder in `apps/api/src/modules/`, then add it to `modules/index.ts` |
| A new exercise type | `packages/contracts/src/content.ts` (schema), `content-tools` (validation), `apps/web/src/features/practice/renderers.tsx` |
| Colours, spacing, dark theme | `apps/web/src/styles/tokens.css` |
| A new content check | `packages/content-tools/src/validate.ts` **and** a fixture in `curriculum/fixtures/` |
| Session lifetime, cookie policy | `apps/api/src/plugins/auth.ts` and `SESSION_ABSOLUTE_DAYS` / `SESSION_IDLE_DAYS` in `apps/api/src/config.ts` |
| Request body limit | global in `apps/api/src/app.ts:47`; per route like `modules/imports/routes.ts:46` |

## Conventions

- ESM everywhere; relative imports carry the `.js` extension.
- TypeScript strict. No `any` casts or `@ts-ignore` to force a build.
- Route handlers validate and delegate; business rules live in `learning-core` or
  module helpers.
- Transactions wrap the writes of one mutation, together with its idempotency
  receipt. Interactive transactions use `TX_OPTIONS` (30 s timeout, 15 s max wait,
  `modules/curriculum/shared.ts:109`) because the default 5 s was too short on a
  contended machine.
- No generic repository wrappers, event bus, CQRS layer or database-portability
  abstraction. This is an ordinary modular monolith and should stay one.

## Reviewer notes (verified by reading, 2026-10-06)

These are places where the code is weaker than its comments or docs suggest. None
was reproduced against a database; each is a reading of the code as committed.

- **Optimistic concurrency without a conditional write.** Reviews, drafts, and
  mission progress check `existing.revision !== body.expectedRevision` and then
  `update` by key (`modules/reviews/routes.ts`, `modules/drafts/routes.ts:89-119`,
  `modules/missions/routes.ts:271-296`). At READ COMMITTED isolation, two
  simultaneous requests carrying the same revision can both pass. Notes use the
  safe form, `updateMany` with `revision` in the `where` and a `count === 0`
  check (`modules/notes/routes.ts:140-150`). The A05 test sends its two requests
  sequentially (`apps/api/tests/learning/reviews.test.ts:157-183`).
- **Two XP helpers.** `grantXp` (`modules/curriculum/shared.ts:51-61`) uses
  `createMany({ skipDuplicates: true })`; missions use `awardXp`
  (`lib/xp.ts:34-56`), whose `try/catch` around `create` cannot recover inside a
  PostgreSQL transaction. Likewise two `recordActivity` helpers exist
  (`modules/curriculum/shared.ts:63-80` and `lib/activity.ts`) with different
  signatures.
- **Idempotency key per click, not per intent.** `useCompleteLesson` generates a
  new `clientEventId` each time the mutation runs (`queries.ts:153`). If a response
  is lost and the learner clicks again, the server sees a new event: XP stays
  single (unique award key) and progress is monotonic, but a second
  `lesson.completed` activity row is written.
- **Placement does not feed concept status**, contrary to specification §3.4.
  See [known-limitations.md](known-limitations.md).

## Exercises

All of these read code; exercises 3 and 4 also need `pnpm install`, and 4 needs
the disposable test database described in [testing.md](testing.md).

**1. Follow the body limit (easy).**
Goal: explain why V2 could not be imported before the final commit.
**Check:** you cite the global `bodyLimit: 1_048_576` (`apps/api/src/app.ts:47`), the route
option `{ bodyLimit: MAX_PACKAGE_BYTES }` (`modules/imports/routes.ts:46`, 10 MiB),
and the 1.9 MB V2 package size from `handoff/01-state.md`.

**2. Find the replay path (easy).**
Goal: in `modules/lessons/routes.ts`, find the line that makes a retried request
return early without writing anything.
**Check:** line 169, `if (replay.replayed && replay.response) return replay.response;`,
inside the transaction that starts at line 161.

**3. Trace a timeout (medium).**
Goal: list the two independent mechanisms that stop an infinite loop, and the
timeout each uses.
**Check:** the QuickJS interrupt handler in `engine.ts` (deadline = start +
`timeoutMs`, 2 s) and the client watchdog in `packages/runner/src/client.ts:195-212`
(`2 × timeoutMs + 1000` = 5 s), which terminates the whole worker. Confirm with
`pnpm --filter @devpractice/runner test`.

**4. Make reviews race-safe (hard).**
Goal: rewrite the `ReviewState` update in `modules/reviews/routes.ts` as a
conditional `updateMany` keyed on `revision`, following `modules/notes/routes.ts:140-150`,
and add an integration test that sends two responses with `Promise.all`.
**Check:** the new test fails before your change (two `200`s, or two
`ReviewEvent` rows) and passes after (one `200`, one `409`), and the existing A05
tests still pass. Run the learning suite alone; it shares a database with the
foundation suite.
