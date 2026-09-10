# Current state — what is real, what is verified

Every "verified" below means a command was run and its output observed. Anything
not verified is listed as not verified. Do not upgrade these claims without
re-running the check.

## Git

    1d81c1e  Author V2 and V3 curriculum chapters
    b147d96  Fix two e2e harness races found after the V1 commit
    dacb8ad  Build DevPractice V1: personal web development learning platform

The repo has its **own** `.git` at `C:\Users\Owner\Desktop\opusboot1`. It sits
INSIDE a stray repo rooted at `C:\Users\Owner` — see `04-gotchas.md` before
running any git command.

Working tree at handoff: `projects/m04` … `projects/m11` are **untracked**
(deliberately — they are unverified; see Outstanding).

## V1 — COMPLETE and verified

Platform: pnpm workspace with `contracts`, `learning-core`, `runner`,
`content-tools`, `apps/api`, `apps/web`. Fastify + Prisma + PostgreSQL,
React + Vite, QuickJS-WASM runner in a Web Worker.

Gates, all executed on this machine:

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

## V2 and V3 chapters — COMPLETE and validated

Committed at `1d81c1e`.

| Release | Chapters | Lessons | Exercises | Cards | Placement |
|---|---|---|---|---|---|
| V2 (N13-N20) | 8 | 24 | 72 | 48 | 40 |
| V3 (D01-D10) | 10 | 30 | 90 | 60 | 50 |

Each group was validated **without** `--skip-verify`, so solutions and starters
executed on the real QuickJS engine. Diversity minimums (§11.4) cleared in all
four groups.

Concept catalogue: `curriculum/concepts.json` extended 115 → 193 ids
(115 `v1`, 32 `v2`, 46 `v3`).

Release manifests `curriculum/release-v2.json` and `release-v3.json` exist and
are **snapshots** (spec §10.1): V2 carries all 12 V1 chapters plus its 8; V3
carries all 30. They currently list only V1's 3 mission assets.

**Important:** each group was validated in ISOLATION (its own chapters plus a
scratch track stub). A **full-release V2/V3 validation has never been run.**
Cross-chapter checks such as `prose.duplicate` only fire when chapters are
assembled together, so expect findings on the first full run.

## V2 and V3 missions — INCOMPLETE

This is the main outstanding work. Two agents were building these and did not
finish.

What exists on disk (untracked):

    projects/m04-support-desk-search/     starter/ solution/
    projects/m05-support-desk-nplus1/     starter/ solution/
    projects/m06-inventory-core/          starter/ solution/
    projects/m07-inventory-idempotency/   starter/ solution/
    projects/m08-inventory-report-job/    starter/ solution/
    projects/m09-dotnet-support-desk/     starter/ solution/  (global.json, src, tests, tools)
    projects/m10-dotnet-efcore-repair/    starter/ solution/
    projects/m11-dotnet-inventory-concurrency/ starter/ solution/

The Node missions have `package.json`, `prisma/`, `src/`, `tests/`,
`vitest.config.ts`. The .NET missions have `global.json`, `src/`, `tests/`.

What does **NOT** exist:

- **M12 (.NET background/comparison mission) — entirely absent.**
- **`curriculum/chapters/v2-missions.json`** — the mission CONTENT items. Absent.
- **`curriculum/chapters/v3-missions.json`** — absent. Both are already listed
  in the release manifests, so a full-release validate will fail until written.
- **Mission asset entries** in `release-v2.json` / `release-v3.json`.
- **Top-level `README.md`** in each new mission.
- **A13 verification** for M04-M11. `docs/missions-verification-v2.md` and
  `-v3.md` do not exist. **No claim of A13 for any of M04-M12 is supported.**

Treat all of M04-M11 as **unverified code of unknown quality** until A13 is run
against it.

## Known defect, unfixed

`v1-track` (defined inside `curriculum/chapters/v1-ch01.json`) enumerates only
`v1-ch01` … `v1-ch12`. The validator checks track→chapter references forward but
never asserts a chapter is listed by its track, so all 18 new chapters validate
while being **unreachable in curriculum navigation**, which reads
`track.chapterIds`. Three independent agents reported this. Fix in
`02-outstanding.md` item 1.
