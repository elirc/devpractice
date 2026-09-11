# Current state — what is real, what is verified

Every "verified" below means a command was run and its output observed. Anything
not verified is listed as not verified. Do not upgrade these claims without
re-running the check.

Updated 2026-09-10, after the V2/V3 mission work.

## Git

The repo has its **own** `.git` at `C:\Users\Owner\Desktop\opusboot1`. It sits
INSIDE a stray repo rooted at `C:\Users\Owner` — see `04-gotchas.md` before
running any git command, and always confirm `git rev-parse --show-toplevel`.

    1d81c1e  Author V2 and V3 curriculum chapters
    b147d96  Fix two e2e harness races found after the V1 commit
    dacb8ad  Build DevPractice V1: personal web development learning platform

Everything described below as new is in the working tree on top of `bf35cc6`
(the handoff commit) and **is not yet committed**.

## V1 — COMPLETE and verified

Platform: pnpm workspace with `contracts`, `learning-core`, `runner`,
`content-tools`, `apps/api`, `apps/web`. Fastify + Prisma + PostgreSQL,
React + Vite, QuickJS-WASM runner in a Web Worker.

Gates, all executed on this machine during the V1 build:

| Gate | Result |
|---|---|
| Content release validate | OK, exit 0, backend **quickjs** |
| Typecheck, 6 packages | 0 errors |
| learning-core unit | 59/59 |
| runner unit | 63/63 |
| content-tools unit | 19/19 |
| web unit | 33/33 |
| API foundation integration | 23/23 |
| API learning integration | 45/45 |
| Playwright e2e | 14/14, twice, `PW_EXIT=0` |

Acceptance scenarios executed: A01-A14, A16, A17, A18.
**A15 (export + database restore drill) was never performed.**

V1 content: 1 track, 12 chapters, 36 lessons, 108 exercises, 72 review cards,
12 assessments (60 placement items), 3 missions (M01-M03, all A13-verified).

## V2 and V3 content — COMPLETE, and now reachable and assembled

### The two reachability defects are fixed

`v1-track` used to live inside `v1-ch01.json` and list only the 12 V1 chapters,
so all 18 new chapters validated while being invisible in curriculum navigation.
Separately, all 18 new chapter items had `missionIds: []`, so all 9 new missions
would have been invisible on every chapter page. The validator checks references
forwards only and caught neither.

Both are fixed:

- the track item now lives in `chapters/v1-track.json` (version 1, 12 chapters),
  `chapters/v2-track.json` (version 2, 20) and `chapters/v3-track.json`
  (version 3, 30), and each manifest lists exactly one of them;
- `v2-ch13` → M05, `v2-ch14` → M06 and M07, `v2-ch15` → M04, `v2-ch16` → M08,
  `v3-ch05` → M09, `v3-ch07` → M11, `v3-ch08` → M10, `v3-ch10` → M12.

Both edges are now **checked by the validator**, so neither can recur:
`validateReachability` in `packages/content-tools/src/validate.ts` raises
`reachability.chapter-unlisted` and `reachability.mission-unclaimed` as errors,
and two new fixtures prove each one fires. The content-tools gate suite went from
19 tests to 21 and passes 21/21.

What a tool still cannot judge is whether a mission sits on the RIGHT chapter.
Any chapter satisfies the check, so that one stays with a reviewer.

### The CLI can now assemble V2 and V3 at all

`packages/content-tools` only ever loaded `curriculum/release.json`. It now takes
`--manifest <file>`, and there are `content:validate:v2`, `:v3`, `content:build:v2`,
`:v3` and `content:assets` scripts. Before this, neither `release-v2.json` nor
`release-v3.json` could be validated or built.

### Full-release validation, run and green — including the behavioural gate

Every release was validated **without** `--skip-verify`, so every solution,
starter and mutant actually executed on the QuickJS engine learners meet. All
three report `backend: quickjs (@devpractice/runner)`.

| Release | Result |
|---|---|
| V1 | OK, exit 0 — 12 chapters, 36 lessons, 108 exercises, 72 cards, 60 placement items, 3 missions; 33/33 solutions pass, 33/33 starters fail as expected, 212 wrong implementations rejected |
| V2 | OK, exit 0 — 20 chapters, 60 lessons, 180 exercises, 120 cards, 100 placement items, 8 missions; 61/61 solutions, 61/61 starters, 425 rejected |
| V3 | OK, exit 0 — 30 chapters, 90 lessons, 270 exercises, 180 cards, 150 placement items, 12 missions; 86/86 solutions, 86/86 starters, 593 rejected |

V3 hits the spec §2.2 combined baseline exactly. This was the first time either
V2 or V3 had ever been assembled and validated as a whole release; the chapter
groups had only been validated in isolation before.

V1's inventory and its two long-standing warnings are unchanged by the track
move, which is the evidence that moving the track item out of `v1-ch01.json` did
not disturb the shipped release.

`prose.duplicate`, which can only fire when chapters are assembled together,
reported **nothing** across all 30 chapters written by four different agents.

Five `verify.mutant-survived` warnings remain, and all five were judged by
running the mutated source: two on `v1-e014` (long-standing), one on `v2-e002`,
two on `v3-e023`. All five are equivalent mutants, and the `v3-e023` pair is
equivalent in principle rather than merely undistinguished — the comparator can
never be called with equal keys. Reasoning and evidence are in
`docs/known-limitations.md`. No solution was rewritten to silence a warning.

### Two authoring errors found and fixed by validation

Both were over-length strings that the schema rejects: M08's third baseline check
(301+ characters, now split in two) and M11's second baseline check (351
characters, now split in two). Nothing else in 18 chapters and 9 mission items
needed changing, and `prose.duplicate` — which only fires on assembly — reported
nothing.

## Missions — all 12 A13 VERIFIED

M01-M03 were verified during V1 (`docs/missions-verification.md`). M04-M08 and
M09-M12 were verified during this work; the full records with every command and
count are in `docs/missions-verification-v2.md` and `-v3.md`.

M12 was verified last (2026-09-11) and needed two passes: its cancellation
check passed on the unmodified starter and had to be strengthened before it
proved anything. See the defect below and the M12 section of
`docs/missions-verification-v3.md`.

Each mission's databases were **dropped and recreated empty** first, so
"migrations apply to an empty database" is a result and not an assumption. Every
starter's mission checks fail with real assertion failures about the assignment,
never with a connection or dependency error — that was checked by reading the
output, mission by mission.

### M08 did not exist as a runnable mission and was built

An earlier session stopped mid-edit. `src/jobs/report.ts`, `src/routes/reports.ts`,
`src/jobs/run.ts`, `tests/baseline.test.ts`, `tests/mission.test.ts`, the
reference solution and both READMEs were missing, and `src/routes/inventory.ts`
described itself in its header as M06's reference solution. All of it was written
and then verified like any other mission.

### Four defects found along the way

- **The .NET missions could not be built at all.** No `.sln` anywhere, and no
  `.csproj` in `starter/`, so every `dotnet build` and `dotnet test` the mission
  text documents would have failed with "no project or solution file found". Four
  solution files were added. Also ~350 MB of stale `bin/` and `obj/` output was
  removed from the four starters.
- **M07's baseline was not repeatable.** `resetDatabase()` cleared five tables and
  left `IdempotencyRecord` alone, so a second `check:baseline` run failed on its
  own fixture row. All five V2 starters were then checked by comparing every model
  in the schema against the tables the reset deletes; M07 was the only gap.
- **M04 shipped a stale `docker-compose.yml`** copied from M02, naming M02's
  container and a database the application could not use. Removed.
- **M12's cancellation check passed on the starter.** It cancelled the token
  before calling `RunAsync`, and EF Core observed the pre-cancelled token on the
  runner's first query — before the runner's loop ran at all — so the check was
  satisfied by the driver, not by the code under test. A fifth instance of
  "tests that assert behaviour they never exercise" (`04-gotchas.md`). The check
  was strengthened (same name, same category): it now cancels from inside the
  loop via the existing `FailOn` hook and asserts the exception escapes, exactly
  3 rows are committed, and the job is left `Queued`. Starter went from
  2 failed / 1 passed to 3 failed / 0 passed; solution 3/3 both times. The
  starter bundle changed, so its checksum in `release-v3.json` was recomputed.

### Mission content items

`curriculum/chapters/v2-missions.json` was written this session (M04-M08).
`v3-missions.json` already existed and was found complete; only the one
over-length baseline check needed fixing. All nine carry `starterCommit: null`.

## Release assets

`dp-content assets` is new: it recomputes a bundled asset directory's checksum by
a documented method (`packages/content-tools/src/asset-checksum.ts`) and compares
it with the manifest, reporting rather than rewriting.

`release-v2.json` declares 8 assets, `release-v3.json` 12. The nine new
checksums were computed with that tool. **V1's three predate it and cannot be
reproduced by it** — the original method was not recorded. They were deliberately
left alone because they belong to a published release; see
`docs/known-limitations.md`.

## V2 and V3 are PUBLISHED

Both were built and published through the real API on 2026-09-11, using
`apps/api/src/scripts/publish-release.ts` — the same CSRF handshake, sign-in,
draft import and explicit publish the owner uses in the Content screen.

| Release | Items | Release id | Published |
|---|---|---|---|
| devpractice-v1 1.0.0 | 244 | `4ba0eb91-…` and `a763e820-…` | 2026-09-09 |
| devpractice-v2 2.0.0 | 409 | `6e6c26ff-dbf6-4d41-8bb8-7d798f35ebe2` | 2026-09-11 |
| devpractice-v3 3.0.0 | 613 | `c3771620-016e-4b26-9ee5-64b20cadcbc0` | 2026-09-11 |

The API reported `Curriculum now exposes 1 track(s), 30 chapter(s)` after the V3
publish, and the live data confirms both reachability edges: the published track
lists 30 chapters, and all 12 missions are claimed by a chapter. That is the
end-to-end proof that the two defects this work started with are really fixed.

The publication transaction held at 613 items, which was the specific risk called
out in the previous handoff. No timeout, no batching change needed.

### The owner password was reset

Publication needs the owner credential and none was recorded. `owner@devpractice.test`
was reset with `pnpm owner:reset-password`, which **revoked 11 active sessions**.
The new password was generated randomly, handed to the owner, and is not stored in
this repository.

### A defect publication surfaced, now fixed

The first publish failed with nothing but `fetch failed`. `app.ts` set a global
`bodyLimit` of 1 MiB and claimed in a comment that content import raised its own;
it did not. A real V2 package is 1.9 MB, so **no genuine release could ever have
been imported** — V1's 1.09 MB package was just small enough to hide it. The
import route now carries `{ bodyLimit: MAX_PACKAGE_BYTES }` (10 MiB), which is the
limit the handler already believed it had. `apps/api` typechecks clean.

### One thing that behaves differently from the previous handoff's advice

That handoff said to bump the track's `version` and leave `masteryRevision` alone.
The author does leave it alone — but the **publisher** owns `masteryRevision` and
derives it from the diff, and `track.chapterIds` is in `BEHAVIOURAL_FIELDS`
(`packages/learning-core/src/content-diff.ts`). So each publish that added chapters
classified `v1-track` as behavioural and incremented it; the live V3 track is
version 3, masteryRevision 3. That is the platform's own rule working as designed,
not a mistake, and it is worth knowing before someone reads
`masteryRevisionsAffected: ["v1-track"]` in a change summary and worries.

## Re-verification after publication — partial

Run after the V3 publish, against the live 30-chapter catalogue:

| Gate | Result |
|---|---|
| API foundation integration | **23/23**, exit 0 |
| API learning integration | **45/45**, exit 0 |
| content-tools unit | **21/21**, exit 0 (was 19; two new reachability fixtures) |
| `apps/api` typecheck | 0 errors |
| `packages/content-tools` typecheck | 0 errors |

Both integration suites match their V1 numbers exactly, so the import body-limit
change and the larger catalogue broke nothing they cover. They were run
sequentially, never in parallel — they share a database.

## NOT done

- **The rest of the gate set has not been re-run.** learning-core, runner and web
  unit suites, the remaining typechecks, and Playwright twice. Nothing in this
  work touched those packages, but that is an argument rather than a result.
- **A15** still never performed.
- WebKit and Firefox still unexercised; docker still unverified; `localOnly` still
  never emitted.

`02-outstanding.md` has all of it in order, with commands.
