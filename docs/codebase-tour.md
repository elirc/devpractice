# Codebase tour

Where things live, how a request travels, and where to make common changes.

## Layout

```
apps/
  api/            Fastify service: auth, content publication, learning records
    src/
      server.ts       app factory + listen
      plugins/        auth, csrf, error handling, request logging
      lib/            errors, idempotency, auth context (shared primitives)
      db/client.ts    the one Prisma client
      modules/        one folder per feature, each exporting registerXRoutes
      scripts/        owner bootstrap, password reset, seed, prune
  web/            React + Vite single-page app
    src/
      routes/         one folder per screen
      features/
        practice/     editor, runner adapter, exercise renderers
      workers/        the runner Web Worker entry
      lib/api.ts      typed fetch client (envelope, CSRF, clientEventId)
packages/
  contracts/      zod schemas + DTOs shared by web, api and tooling
  learning-core/  PURE rules: scheduling, evidence, XP, placement
  runner/         QuickJS-WASM bounded execution + Node-side twin
  content-tools/  validation + snapshot build CLI (dp-content)
prisma/           platform schema and migrations
curriculum/       authored content, concept catalog, fixtures
projects/         runnable learning repositories (M01–M03)
docs/             this documentation
```

## Module boundaries that matter

**`learning-core` has no I/O.** Scheduling, evidence classification, XP and
placement rules are pure functions with an injected clock. This is what makes
them testable without a database, and it is why the rules can be read in one
place rather than being scattered through route handlers.

**`contracts` is the only shared vocabulary.** If web and api disagree about a
shape, the fix belongs there, not in a cast on one side.

**`runner` is used twice.** The browser runs it in a Web Worker; the content
CLI runs the Node twin. Same protocol, same comparison logic — so an exercise
verified at build time grades identically for the learner.

**The platform database is separate from every learning-project database.** A
beginner's intentionally broken query in M02 cannot reach learning records.

## How a lesson completion travels

1. **Web** — the learner clicks Complete. `lib/api.ts` generates a
   `clientEventId` (crypto.randomUUID) and POSTs to `/api/v1/lessons/:id/complete`.
2. **Plugins** — the auth plugin resolves the session cookie into
   `request.owner`; the CSRF plugin checks Origin and the session-bound token.
3. **Route** — `modules/lessons/routes.ts` validates the body against a static
   application-authored schema.
4. **Service, in one transaction** —
   `findReceipt` (replay? return the stored response) →
   check every required exercise has a passing attempt →
   write `LessonProgress` →
   award XP through its unique `awardKey` →
   append an `ActivityEvent` →
   `storeReceipt`.
5. **Response** — `{ data }`. A retry with the same `clientEventId` returns this
   identical response and awards nothing further.

The transaction boundary is the point: a crash midway leaves neither the
completion nor the receipt, so the retry genuinely redoes the work.

## Where to change common things

| Change | Where |
| --- | --- |
| Review intervals or evidence thresholds | `packages/learning-core/src/` |
| A new API endpoint | new folder in `apps/api/src/modules/`, then add it to `modules/index.ts` |
| A new exercise type | `packages/contracts/src/content.ts` (schema), `content-tools` (validation), `features/practice` (renderer) |
| Colours, spacing, dark theme | `apps/web/src/styles/` CSS custom properties |
| A new content check | `packages/content-tools/src/validate.ts` **and** a fixture in `curriculum/fixtures/` |
| Session lifetime, cookie policy | `apps/api/src/plugins/auth` and `config.ts` |

## Conventions

- ESM everywhere; relative imports carry the `.js` extension.
- TypeScript strict. No `any` casts or `@ts-ignore` to force a build.
- Route handlers validate and delegate; business rules live in services.
- Transactions live at the service boundary, not in route handlers.
- No generic repository wrappers, event bus, CQRS layer or database-portability
  abstraction. This is an ordinary modular monolith and should stay one.
