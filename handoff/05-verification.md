# Verification commands

Run from the repository root unless stated. Bash tool syntax.
Confirm the database is up first (`03-environment.md`).

These are the exact commands whose results are recorded in
`docs/final-verification.md`. Reproduce them before trusting any claim.

## Content gate (the most important one)

    pnpm content:validate            # V1
    pnpm content:validate:v2         # V2
    pnpm content:validate:v3         # V3

Or directly, which is what those scripts do:

    cd packages/content-tools
    ./node_modules/.bin/tsx src/cli.ts validate
    ./node_modules/.bin/tsx src/cli.ts validate --manifest release-v2.json --target v2

Expect `OK`, exit 0, and — critically — this line:

    Solution verification (backend: quickjs (@devpractice/runner))

If it says `node:vm`, the QuickJS runner failed to load and the gate is testing
the wrong engine. That is a **failure**, not a detail. See `04-gotchas.md`.

Add `--package <file>` to validate one assembled package, or `--manifest <file>`
to assemble a different release. Read `src/cli.ts` for the current flags rather
than guessing. `--skip-verify` skips the behavioural gate — run WITHOUT it at
least once, or solutions and starters never execute.

`pnpm content:assets` (and `assets:v2`, `assets:v3`) recomputes every bundled
asset's checksum from the files on disk and compares it with the manifest. On V1
it reports three mismatches; that is expected and explained in
`docs/known-limitations.md`, not a regression.

## Typechecks (all six packages)

    for p in packages/contracts packages/learning-core packages/runner \
             packages/content-tools apps/api apps/web; do
      (cd $p && ../../node_modules/.bin/tsc --noEmit >/dev/null 2>&1; echo "$p tsc=$?")
    done

All must print `tsc=0`. TypeScript is strict; do not silence with `any` or
`@ts-ignore`.

## Unit suites

    (cd packages/learning-core && ../../node_modules/.bin/vitest run)   # 59/59
    (cd packages/runner        && ../../node_modules/.bin/vitest run)   # 63/63
    (cd packages/content-tools && ../../node_modules/.bin/vitest run)   # 19/19
    (cd apps/web               && ../../node_modules/.bin/vitest run)   # 33/33

`packages/runner` is the security gate (A07 isolation, A08 type-error rejection).
It takes ~90s and legitimately runs an infinite loop and an allocation bomb.

## API integration — SEQUENTIALLY, never in parallel

    cd apps/api
    ../../node_modules/.bin/vitest run --config vitest.integration.config.ts   # 23/23
    ../../node_modules/.bin/vitest run --config tests/learning/vitest.config.ts # 45/45

These share one database and will wipe each other's fixtures if run
concurrently. Roughly 5 and 7 minutes on this machine. Under memory pressure
they produce `PrismaClientInitializationError` — re-run before believing a red
result.

## End-to-end (A12, A14, browser runner)

Needs: the API running, a bootstrapped owner, and a published release.

    # 1. start the API in the background
    cd apps/api && ../../node_modules/.bin/tsx watch src/server.ts

    # 2. publish a release (see apps/api/src/scripts/publish-release.ts)

    # 3. run the suite (Playwright starts Vite itself)
    cd apps/web && ./node_modules/.bin/playwright test

Expect **14/14**, `PW_EXIT=0`.

**Run it twice.** Two runs of identical code once gave 10/2 then 9/3, and a
single green run would have been reported as a pass. Treat any divergence
between runs as a defect to diagnose, not noise to average.

Chromium r1148 only. WebKit/Firefox have never been exercised.

## Mission gate (A13) — for each mission

    # inside projects/<mission>/starter
    npm install                # or: dotnet restore && dotnet build
    <baseline command>         # MUST pass
    <baseline command>         # again — proves the seed and fixtures are repeatable
    <mission command>          # MUST fail, for the intended reason

    # then against the reference solution
    <baseline command>         # MUST pass
    <mission command>          # MUST pass
    # and restore the starter file afterwards

Read the actual failure text at the mission step. A failure from a missing
dependency or a DB connection error is a broken assignment, not a correctly
failing one.

Run the baseline **twice**. That is what caught M07, whose reset left one table
alone so the second run failed on its own fixture row.

Drop and recreate each mission's databases first, or "migrations apply to an empty
database" is an assumption rather than a result. The .NET missions have no
migrations — they use `EnsureCreatedAsync` — so for those the equivalent proof is
EnsureCreated against a recreated database plus two baseline runs. Say it that way.

Two reusable scripts from the last session are worth reading before writing your
own: the chained Node flow in `docs/missions-verification-v2.md`'s command list,
and `a13-dotnet.sh`, which the V3 record names. Each mission owns its own
database; never point one at the platform's (spec §5.2).

## Whole-repo sweep

`pnpm -r test` has never been run as a single pass on this machine — suites were
always run individually. If you try it, note that the API integration suites must
not run in parallel with each other.

## What "verified" means

Use the spec §1.3 labels. A screenshot proves layout, not persistence. A green
reference solution proves one implementation passes, not that the grader rejects
wrong ones — that is what the mutant checks are for. A client-reported pass is
learning feedback, not proctoring.
