# Outstanding work, in dependency order

Read `03-environment.md` first. Do not start item 3 before item 1 and 2.

---

## 1. Fix the track item so V2/V3 chapters are reachable

**Problem.** `v1-track` lives inside `curriculum/chapters/v1-ch01.json` and lists
only the 12 V1 chapters. The curriculum UI renders from `track.chapterIds`, so
the 18 new chapters would never appear. Validation does not catch this.

**Why you cannot just edit it in place.** Releases are snapshots. If the V1
release's track listed `v2-ch13`, the V1 release would reference a chapter it
does not contain and fail `reference.missing`. Each release needs a track item
listing exactly its own chapters.

**Approach that fits the data model.** `ContentVersion` is unique on
`(itemId, version)`, and a release maps each itemId to ONE version. So the same
`v1-track` item can exist at version 1, 2 and 3, with each release pinning the
one it needs. Adding chapters to a track is an EDITORIAL change: bump `version`,
leave `masteryRevision` alone (spec §8.2).

Suggested shape:

1. Move the track item out of `v1-ch01.json` into
   `curriculum/chapters/v1-track.json` (version 1, the 12 V1 chapter ids).
2. Create `curriculum/chapters/v2-track.json` — same id `v1-track`, `version: 2`,
   same `masteryRevision`, chapterIds = 12 V1 + 8 V2.
3. Create `curriculum/chapters/v3-track.json` — `version: 3`, chapterIds = 12 V1
   + 8 V2 + 10 V3.
4. Update `chapterFiles` in each manifest: `release.json` uses `v1-track.json`;
   `release-v2.json` uses `v2-track.json`; `release-v3.json` uses `v3-track.json`.
   Each manifest must reference exactly ONE track file.
5. Re-run the V1 full validate to prove you did not break the shipped release.

**Verify:** V1 validate still exits 0 with the same inventory, and a V2 validate
reports 20 chapters under the track.

---

## 2. Write the mission content items

`curriculum/chapters/v2-missions.json` and `v3-missions.json` are already listed
in the manifests and do not exist, so a full-release validate fails immediately.

Copy the shape from `curriculum/chapters/v1-missions.json`; the schema is
authoritative in `packages/contracts/src/content.ts` (`missionItemSchema`).

Required per mission: `projectId`, `workType`, `stack`, `release` (`"v2"`/`"v3"`),
`chapterPrerequisiteIds`, `starterAssetId`, `starterCommit` (**`null`** — never
invent a hash), `setup`, `baselineChecks`, `acceptanceCriteria`,
`verificationCommands`, `checklist`, exactly three progressive `hints`,
`solutionMarkdown`, `reflectionRubric`.

**`setup`, `baselineChecks` and `verificationCommands` must match the real
repository** — real filenames, real commands. Verify them by running them.

Missions and their intent (spec §13.5):

| Mission | Intent |
|---|---|
| M04 | extend search + stable cursor pagination; no duplicates across pages |
| M05 | investigate an N+1; compare query counts, preserve behaviour |
| M06 | build products/stock movements/orders; enforce invariants |
| M07 | repair duplicate order submission; idempotency + transactions |
| M08 | retryable background report job; reruns must not duplicate effects |
| M09 | equivalent ticket API in ASP.NET Core; existing React frontend unchanged |
| M10 | repair EF Core projection/tracking; verify SQL and resource ownership |
| M11 | EF Core transactions + concurrency tokens; conflicting edits, rollback |
| M12 | **does not exist** — cancellable background workflow, compared with M08 |

---

## 3. Build M12, then verify A13 for M04-M12

**A13 is the gate. Nothing about these missions may be claimed until it runs.**

For EACH mission, in a fresh environment:

1. Dependencies install (`npm install`, or `dotnet restore`).
2. **Baseline checks pass** — proves the starter runs.
3. **Mission checks FAIL, for the intended reason.** Read the actual output. A
   failure from a missing dependency or a DB connection error is a BROKEN
   ASSIGNMENT — fix the starter, do not record it as a pass.
4. **The reference solution passes both.**
5. Migrations apply to an EMPTY database; run the seed TWICE and prove it is
   repeatable.

Baseline and mission checks must be **separate named commands** so the owner can
distinguish an intentionally incomplete assignment from a broken setup.

Each mission gets its **own database** — never the platform database, never
another mission's (spec §5.2).

Mission-specific proofs that must actually run:

- **M07**: concurrent duplicate submissions replay one result; the same key with
  a DIFFERENT payload conflicts rather than replaying.
- **M08 / M12**: inject a failure mid-job, rerun, prove committed effects are not
  duplicated. Make any delivery guarantee explicit — never say "exactly once"
  without defining the boundary.
- **M11**: two genuinely conflicting edits raise and handle
  `DbUpdateConcurrencyException`; rollback leaves NO partial write.
- **M09**: the existing React frontend works unchanged against the .NET API.

Record results in `docs/missions-verification-v2.md` and `-v3.md`, in the style
of the existing `docs/missions-verification.md`. State per mission whether A13
genuinely passed.

There is a known precedent worth checking for in these starters: M02/M03 both
shipped with `src/db.ts` using `new PrismaClient()` (reading `DATABASE_URL`)
while the test helper used `TEST_DATABASE_URL`, so fixtures were invisible to the
route under test. It made the reference solution fail 6 of 12 checks. Check the
new Node missions for the same defect.

---

## 4. Add mission assets to the release manifests

Append each starter to `assets` in `release-v2.json` / `release-v3.json` with a
real `sha256` checksum, matching the `starterAssetId` used in the mission items.
Follow the three existing V1 entries exactly.

---

## 5. Run the FULL-RELEASE validation for V2 and V3

This has never been run and is where cross-chapter problems surface.

    cd packages/content-tools
    ./node_modules/.bin/tsx src/cli.ts validate            # V1, must stay green
    # then the V2 and V3 manifests — check cli.ts for the manifest flag

Expect findings. `prose.duplicate` fires only when chapters are assembled
together, and four agents authored these without seeing each other's work.

Confirm the inventory reaches the spec §2.2 combined baseline: **30 chapters, 90
lessons, 270 exercises, 180 review cards, 150 placement items, 12 missions.**

On surviving mutants: decide honestly whether it is **weak coverage** (add a
discriminating case) or an **equivalent mutant** (verify by running the mutated
source; then either remove an incidental mutation site or document it). Do NOT
rewrite a solution to silence a warning when the construct is what the lesson
teaches — see `docs/known-limitations.md` for the `v1-e014` precedent.

---

## 6. Publish and re-verify the platform

1. Import and publish the V2 (then V3) release through the API, as
   `apps/api/src/scripts/publish-release.ts` does.
2. Re-run the full gate set in `05-verification.md`. The platform must still be
   green with the larger release — publication previously blew Prisma's 5s
   transaction budget and could not have worked on a real release.
3. Check performance against §14.3 on the bigger catalogue.

---

## 7. Still outstanding from V1

- **A15 backup/restore drill** was never performed. Restore a real database
  backup into a clean environment and compare record counts.
- **Only Chromium** has ever been exercised — in the runner and in e2e. WebKit
  and Firefox are unverified.
- The `docker compose` local-dev path is unverified (Docker is broken here).
- `localOnly` is never emitted by the API, but `ExercisePanel` reads it to explain
  browser-unrunnable work and link to a mission (spec §3.3, §4.3). The release has
  zero `local-project` exercises so nothing renders badly today — the first one
  authored will silently lose that affordance.
- Two synthetic accounts exist in the dev database: `e2e-runner@devpractice.test`
  and `runner-verify@devpractice.test`. Delete if unwanted.
