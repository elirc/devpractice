# Implementation checklist

Status vocabulary follows specification §1.3. **Nothing is marked verified
unless the check was actually run and its output observed.**

Last updated: 2026-09-09, by the content-tooling / missions / docs workstream.

> **Status note (2026-10-06).** Frozen V1 build record. Rows marked "not started"
> below (P4 chapters, P5, P6/P7 V2 and V3) were all completed later: V1, V2 and V3
> are published and M01–M12 are A13 verified. Only A15 (export and restore) is
> still not performed. Current state: [`handoff/01-state.md`](../handoff/01-state.md).

## Ownership note

V1 was built by five parallel workstreams with disjoint file ownership. This
file records what **this** workstream (content tooling, missions, documentation)
did and verified. Rows owned by other workstreams are marked *(other workstream)*
and their status is **not asserted here** — each owner updates their own rows.

---

## P0 — foundations and feasibility

| Ticket | Status | Evidence |
| --- | --- | --- |
| P0-01 repository assessment, docs skeleton | implemented | Workspace created; `docs/product-spec.md`, this checklist and `docs/decisions/0001-architecture.md` written |
| P0-02 toolchain and local setup | implemented | pnpm workspace, 6 packages, pinned versions, `.env.example`, `docker-compose.yml`. `prisma validate` **passed (exit 0)** on `prisma/schema.prisma` |
| P0-03 runner feasibility spike | *(other workstream)* | Gate A07/A08 — see that workstream's report |
| P0-04 contract fixtures | **verified** | `packages/contracts/src/{content,api,runner,domain}.ts`; 1 valid + 12 deliberately-broken fixtures in `curriculum/fixtures/`; every check proven to fire (see below) |

---

## P1 — first complete learning journey

| Ticket | Status |
| --- | --- |
| P1-01 owner authentication | *(other workstream)* |
| P1-02 navigation and catalog | *(other workstream)* |
| P1-03 exercises and reveals | *(other workstream)* |
| P1-04 attempts and completion | *(other workstream)* |

## P2 — sync and learning evidence

| Ticket | Status |
| --- | --- |
| P2-01 draft and note persistence | *(other workstream)* |
| P2-02 evidence and placement | *(other workstream)* |
| P2-03 review engine | *(other workstream)* |
| P2-04 Today and progress | *(other workstream)* |

---

## P3 — projects and content operations

| Ticket | Status | Evidence |
| --- | --- | --- |
| P3-01 mission workflow (app screens) | *(other workstream)* | — |
| P3-02 support-desk repositories | implemented; **partially verified** | M01/M02/M03 written with starters, reference solutions, baseline + mission checks, seeds, READMEs. A13 verified for M01 only — see below |
| P3-03 content build CLI | **verified** | `dp-content` validate/build/inventory; 17/17 gate checks pass |
| P3-04 import and publication UI | *(other workstream)* | — |

### P3-03 detail — what the content gate actually proves

Command run:

```
node --import tsx packages/content-tools/tests/gate-harness.mjs
```

Result: **ALL GATES PASS** (17 checks, exit 0).

| Check | Fixture | Issue code fired |
| --- | --- | --- |
| valid package accepted | `valid-chapter.json` | none (0 errors) |
| inventory counts | `valid-chapter.json` | 1 lesson / 3 exercises / 2 cards / 5 placement items |
| broken reference | `invalid-bad-reference.json` | `reference.missing` |
| reused version number | `invalid-duplicate-version.json` | `version.duplicate` |
| prerequisite cycle | `invalid-prerequisite-cycle.json` | `prerequisite.cycle` |
| unsupported field | `invalid-unknown-field.json` | `field.unknown` |
| runtime field in content | `invalid-forbidden-field.json` | `field.forbidden` |
| `javascript:` link | `invalid-unsafe-link.json` | `link.unsafe` |
| repeated hints | `invalid-duplicate-hints.json` | `hint.duplicate` |
| placement copied from a lesson | `invalid-copied-placement.json` | `placement.copied` |
| objective with no exercise | `invalid-uncovered-objective.json` | `concept.uncovered-objective` |
| concept not in catalog | `invalid-unknown-concept.json` | `concept.unknown` |
| starter already passes | `invalid-always-passing-starter.json` | `verify.starter-already-passes` |
| cases too weak for a constant | `invalid-weak-cases.json` | `grading.uniform-expectations` + surviving mutant |

Behavioural gate on the specification's own example exercise
(`js-arrays-filter-open`): reference solution passes; starter fails; and all
three specification-named mutants are **rejected** — always-zero (`constant-0`),
count-all (`filter-accepts-all`) and input-mutating (`mutates-input`), along with
`constant-2`, `constant-1`, `identity-first-arg` and `flip-strict-equality`.

> The harness earned its keep: its first run failed, exposing a real bug in the
> mutant generator — the input-mutating mutant pushed and then popped, so it did
> not actually mutate and `assertInputUnchanged` was never exercised. Fixed, then
> re-run to green.

**Runner backend caveat:** the gate ran on the `node:vm` build-time fallback
because `packages/runner` was still being built by another workstream. The
adapter prefers `@devpractice/runner/node` and falls back only when it is
unavailable; both share the comparison logic from `@devpractice/contracts`.
**Re-run the gate once the QuickJS runner lands** so authored content is verified
by the same engine the learner uses.

---

## P4 — V1 curriculum production

| Ticket | Status | Notes |
| --- | --- | --- |
| P4-01 chapters 1–4 | **not started** | Content-authoring wave |
| P4-02 chapters 5–8 | **not started** | |
| P4-03 chapters 9–12 | **not started** | |
| P4-04 editorial review | **not started** | Gate A17 |

Prepared for that wave:

- `curriculum/concepts.json` — **115 concept ids** covering chapters 1–12,
  validated against the catalog schema.
- `curriculum/release.json` — lists `chapters/v1-ch01.json` … `v1-ch12.json`.
  Until those exist, `pnpm content:validate` fails naming the missing file. That
  is the intended signal, not a defect.
- `curriculum/fixtures/valid-chapter.json` — a complete passing chapter to copy.
- `curriculum/verification.json` — empty starter exemptions and declared mutants.

**Current V1 inventory: 0 of 36 lessons, 0 of 108 exercises, 0 of 72 cards,
0 of 60 placement items.** V1 content is not authored.

---

## P5 — hardening and V1 release

| Ticket | Status |
| --- | --- |
| P5-01 end-to-end verification | not started |
| P5-02 export and recovery | *(other workstream)* |
| P5-03 production packaging | not started |
| P5-04 handoff | implemented — `docs/handoff.md` and this file |

## P6 / P7 — V2 and V3

**Not started.** Deliberately out of scope until V1 is complete and verified.
No part of the V2 production-depth or V3 .NET curriculum exists.

---

## Acceptance matrix status

| ID | Status | Note |
| --- | --- | --- |
| A01 account isolation | *(other workstream)* | |
| A02 durable progress | *(other workstream)* | |
| A03 idempotent credit | *(other workstream)* | |
| A04 conflicting draft | *(other workstream)* | |
| A05 review concurrency | *(other workstream)* | |
| A06 assistance integrity | *(other workstream)* | |
| A07 runner isolation | *(other workstream)* | |
| A08 TypeScript verification | *(other workstream)* | |
| A09 content atomicity | *(other workstream)* | publication transaction |
| A10 archived content | *(other workstream)* | |
| A11 placement | *(other workstream)* | |
| A12 mobile use | *(other workstream)* | |
| **A13 project reproducibility** | **M01 verified; M02/M03 not verified** | see below |
| A14 network recovery | *(other workstream)* | |
| A15 export and restore | not started | |
| A16 no AI dependency | **holds by construction** | no inference client, credential or provider request exists anywhere in the repository |
| **A17 content quantity and quality** | **fails — content not authored** | the gate that will check it is built and proven |
| A18 release activation | *(other workstream)* | |

### A13 detail

| Mission | Install | Baseline | Mission fails first | Solution passes |
| --- | --- | --- | --- | --- |
| M01 support desk web | **verified** (139 pkgs) | **verified** 8/8 pass | **verified** 9 fail, correct reason | **verified** 17/17 pass |
| M02 persistent API | **not verified** | — | — | — |
| M03 ownership defect | **not verified** | — | — | — |

**M01 is fully verified against A13.** Commands and real output:

```
npm install                              # 139 packages
npx vitest run tests/baseline.test.tsx   # Test Files 1 passed | Tests 8 passed
npx vitest run tests/mission.test.tsx    # Test Files 1 failed | 9 failed
#   every failure is "Unable to find [data-testid=ticket-list]" and similar —
#   the features the learner must build, NOT environment or timeout errors
cp -r ../solution/src/. src/             # overlay the reference solution
npx vitest run                           # Test Files 2 passed | Tests 17 passed
#   starter source then restored from backup
```

Two real defects were found by running this rather than assuming it:

1. `tests/setup.ts` imported `@testing-library/jest-dom/vitest`, which did not
   register the matchers — every DOM assertion failed with
   `Invalid Chai property: toBeInTheDocument`. Fixed by extending `expect`
   explicitly with the matchers module.
2. The form tests timed out at vitest's 5 s default on this machine. Fixed with
   `userEvent.setup({ delay: null })` and a 30 s `testTimeout`, so a slow machine
   does not look like a failing assignment.

M02 and M03 both require PostgreSQL. `docker version` **hung and timed out** on
this machine, so no container could be started and neither mission's checks were
executed. Their code, tests, seeds and solutions are written but **unverified**.
Anyone with a working PostgreSQL should run, for each of M02 and M03:

```bash
cp .env.example .env
docker compose up -d db
npm install && npm run db:migrate && npm run db:seed
npm run check:baseline    # expect pass
npm run check:mission     # expect FAIL before the work
# apply solution/src over starter/src, then re-run both
```

---

## Known gaps

1. **V1 content is not authored.** This is the single largest remaining item and
   the reason A17 fails.
2. **M02 and M03 are unverified** — Docker hangs on this machine.
3. **The content gate has not run against the QuickJS runner** — re-run once
   `packages/runner` is available so the CLI and the browser share an engine.
4. **Root `pnpm install` did not complete its linking phase.** `node_modules/`
   contains `.pnpm/` but no `.modules.yaml` and no package links. This
   workstream worked around it with verification-only junctions under
   `packages/{content-tools,contracts}/node_modules` (gitignored, reversible). A
   clean `pnpm install` at the root is still needed. Note that
   `pnpm install | tail` **masks pnpm's exit code** — that is how the original
   failure went unnoticed.
