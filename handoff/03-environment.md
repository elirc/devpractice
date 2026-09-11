# This machine — read before running anything

Windows 11. Node 22.16.0, pnpm 9.12.3, .NET SDK 10.0.302, PostgreSQL 18.
The box is **slow and memory-constrained**. Budget generous timeouts and do not
conclude something has hung when it is merely slow.

## Database — not durable

**Docker is broken here.** `docker compose up -d db` fails with "Docker Desktop
is unable to start", and `docker version` hangs. Do not try; it will burn your
time. The documented docker path in the README is therefore unverified.

PostgreSQL 18 is **hand-started** instead:

- listening on `127.0.0.1:5440`
- data directory `C:\Users\Owner\pgdata-devpractice`
- databases `devpractice` and `devpractice_test`
- the restart command is in a comment in `.env`

It **will not survive a reboot**, and it has already died twice under memory
pressure. If Prisma suddenly cannot connect, check the port before debugging
code:

    netstat -ano | grep 5440

**A durable fix exists but needs elevation**: the `postgresql-x64-18` Windows
service is installed and set to Automatic. From an ADMIN terminal,
`Start-Service postgresql-x64-18` gives a database that comes back on its own.
It defaults to **port 5432**, so `DATABASE_URL` must be repointed.

## Package installs — the single biggest hazard here

Concurrent `pnpm install` runs **destroyed this workspace four times** during the
V1 build. Symptoms: `ERR_PNPM_EBUSY` from stale `*_tmp_*` extraction dirs,
`node_modules` collapsing to a handful of packages, `npx` fetching wrong versions
from the registry mid-run.

Rules:

- Run **at most one** install, and never while another agent or process might.
- If `node_modules` looks broken: `rm -rf node_modules apps/*/node_modules
  packages/*/node_modules`, then a single `pnpm install`, and check the REAL exit
  code (see `04-gotchas.md`).
- Installing **inside** a mission under `projects/` is fine and expected — those
  are separate repos outside the workspace.

## Binaries — there is no root `.bin/tsx`

Use workspace binaries:

    node_modules/.bin/vitest                          # root: vitest, tsc, prisma
    packages/content-tools/node_modules/.bin/tsx      # tsx lives here
    apps/web/node_modules/.bin/playwright

`npx` has resolved the WRONG package here more than once (it installed nothing
while reporting success, and separately tried to fetch `vitest@5`). Prefer the
explicit path.

## Test databases are shared

`apps/api/tests/foundation/` and `apps/api/tests/learning/` truncate the same
database and **cannot run concurrently** — each wipes the other's fixtures. The
`test:integration` script chains them sequentially, which is safe. Any parallel
invocation produces phantom failures that look exactly like real bugs.

## Memory pressure produces fake failures

With ~1.5-2 GB free, the API integration suites fail with
`PrismaClientInitializationError` — 8 to 14 failures, varying per run. The same
tests pass individually and the full suite returns 45/45 once memory frees up.

**A red integration run on a loaded machine must be re-run before it is
believed.** Check free memory first:

    Get-CimInstance Win32_OperatingSystem | ForEach-Object { $_.FreePhysicalMemory/1MB }

Much of the memory is consumed by unrelated applications (a browser, another
tool's runtime). Do not kill them — they are not yours.

## Disk

~26 GB free at handoff. It was **completely full** at the start of this build,
which broke file writes with `ENOSPC` and corrupted an install. If it tightens,
`npm cache clean --force` reclaimed ~4.4 GB safely. Mission `node_modules` under
`projects/` are large; removal commands are in `docs/missions-verification.md`.

## Playwright

Chromium **r1148** is installed and matches pinned `@playwright/test@1.49.0`.
Newer builds (r1217, r1243) are also on disk and do NOT match — a mismatch
manifests as `browserType.launch` failing.

The e2e config starts Vite itself but expects the API to be started separately.
On Windows the `webServer` command must be `node ./node_modules/vite/bin/vite.js`
— a `./`-prefixed path is not a recognised command under `cmd.exe`.

## Wall-clock, measured during the V2/V3 mission verification

Budget from these, not from experience on a normal machine:

| Thing | Observed |
|---|---|
| One `vitest run` of a mission suite | 25s to 235s; the first run after an edit is the slow one (transform + collect dominate) |
| `tsc --noEmit` in a mission | 60 to 120s |
| A content `validate --skip-verify` | 60 to 120s |
| `dotnet restore` for a mission (warm NuGet cache) | 10 to 20s |
| `dotnet build` for a mission, cold `obj/` | **3 to 8 minutes** |
| `dotnet test --filter Category=...` | 20s to 2 minutes |

The OS **killed a background `vitest` run** during this work because free memory
fell under about 0.5 GB. Run one heavy process at a time, full stop. If a
background job dies with no test output and no error, suspect the memory killer
before you suspect the code.

Useful check before starting anything long:

    powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB"

Under 0.7 GB free, do not start a second one.
