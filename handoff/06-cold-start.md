# Cold start — from a fresh clone (or a fresh reboot) to a running app

Commands verified against the real scripts in this repo, not guessed. Bash tool
syntax, run from the repository root.

Read `03-environment.md` first if anything fails — most failures here are
environmental, not code.

## 1. Database

**Docker does not work on this machine.** Do not run `docker compose up`.

After a reboot the hand-started PostgreSQL is gone. Check first:

    netstat -ano | grep 5440

If nothing is listening, either restart the hand-started cluster (the command is
in a comment in `.env`, data at `C:\Users\Owner\pgdata-devpractice`), or — better
— from an **admin** terminal start the real service:

    Start-Service postgresql-x64-18

That service defaults to **port 5432**, so update `DATABASE_URL` and
`TEST_DATABASE_URL` in `.env` if you use it.

`.env` has CRLF line endings and unquoted `&` in the URLs, so `set -a; . .env` in
bash silently yields EMPTY values. Pass variables explicitly instead.

## 2. Dependencies

Only if `node_modules` is missing or broken. **One install, nothing else running:**

    rm -rf node_modules apps/*/node_modules packages/*/node_modules
    pnpm install > /tmp/install.log 2>&1; echo "EXIT=$?"

Check that `EXIT=0` **and** `node_modules/.modules.yaml` exists. Do not pipe this
through `tail` — you will read the pipe's exit code, not pnpm's. That exact
mistake reported a failed install as success twice.

## 3. Schema

    node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma

Use the local binary, never `npx prisma` — the npx shim **hangs indefinitely** on
this machine (reproduced standalone, killed at five minutes).

## 4. Owner account

Interactive:

    pnpm owner:bootstrap

Non-interactive (the password is read from the environment, never from argv, and
is never logged):

    OWNER_EMAIL=owner@example.test OWNER_PASSWORD=... pnpm owner:bootstrap

It refuses to create a second owner unless `ALLOW_ADDITIONAL_OWNERS=true` — this
is a single-owner application (spec §6). Two synthetic accounts already exist in
the dev database from verification: `e2e-runner@devpractice.test` and
`runner-verify@devpractice.test`.

To reset: `pnpm owner:reset-password` (also revokes every session).

## 5. Build and publish a content release

Validate and build the package:

    cd packages/content-tools
    ./node_modules/.bin/tsx src/cli.ts validate      # must say backend: quickjs
    ./node_modules/.bin/tsx src/cli.ts build         # check src/cli.ts for flags

Then publish it **through the real API**, with the API already running:

    API_BASE=http://127.0.0.1:3001 \
    OWNER_EMAIL=... OWNER_PASSWORD=... \
    tsx src/scripts/publish-release.ts <package.json>

Note why this script exists rather than a direct database write: it drives the
same CSRF handshake → sign-in → draft import → explicit publish path the owner
uses in the Content screen, so local setup exercises the real publication code
(spec §10.4) instead of a shortcut that could hide a defect in it. Publication
atomicity has already broken once here — keep using this path.

## 6. Run it

    pnpm dev            # api + web in parallel

Or individually:

    (cd apps/api && ../../node_modules/.bin/tsx watch src/server.ts)
    (cd apps/web && ./node_modules/.bin/vite --port 5173 --strictPort)

Web dev server on `http://localhost:5173`, API on `http://127.0.0.1:3001`.
In production both are served from ONE origin by the API process, with a SPA
fallback that must never shadow `/api` — verified by `/api/v1/does-not-exist`
returning JSON 404 rather than the HTML shell.

If a server appears to start but the app misbehaves, check for an **orphaned dev
server holding the port** — one previously answered a health probe while the
intended server had failed with "port in use". Check the process, not the port.

## 7. Confirm it actually works

Do not trust the app rendering. Run the gates in `05-verification.md`, starting
with the content gate — and confirm it reports `backend: quickjs`, not
`node:vm`.

## Where things live

| Path | What |
|---|---|
| `docs/product-spec.md` | The authoritative specification. Read before changing behaviour. |
| `docs/codebase-tour.md` | Folder-by-folder tour, request path, where to make common changes |
| `docs/learning-algorithms.md` | Evidence, review scheduling, placement, XP, with examples |
| `docs/content-authoring.md` | Content schema, commands, publication workflow |
| `docs/known-limitations.md` | What this product does NOT claim |
| `docs/final-verification.md` | Every V1 gate result, and what was not verified |
| `docs/decisions/` | Architecture decision records |
| `packages/contracts/src/` | Shared schemas and DTOs — the client/server boundary |
| `packages/learning-core/src/` | Pure rules: scheduler, evidence, XP, grading |
| `packages/runner/src/` | QuickJS sandbox, Node + browser hosts |
| `packages/content-tools/src/` | Validation CLI and mutant gates |
| `curriculum/` | Authored chapters, concept catalogue, release manifests |
| `projects/` | Runnable mission repositories (separate from the workspace) |
