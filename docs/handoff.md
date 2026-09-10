# Handoff

For the next person or model picking this up. Read this, then
[implementation-checklist.md](implementation-checklist.md), then verify the
present state **before** changing it.

## Where the project actually stands

V1 is **not** complete. The platform skeleton, shared contracts, data model and
the content toolchain exist; the V1 curriculum does not.

| Area | State |
| --- | --- |
| Workspace, pinned toolchain, Prisma schema | implemented; `prisma validate` passed |
| Shared contracts (`packages/contracts`) | implemented — content schema, API envelope, runner protocol, domain rules |
| Content CLI + gates (`packages/content-tools`) | **verified** — 17/17 gate checks pass |
| Concept catalog | implemented — 115 ids for chapters 1–12 |
| Missions M01 / M02 / M03 | written; only M01 executed |
| Documentation | implemented |
| API, web app, runner, learning-core | built by other workstreams — see their reports |
| **V1 curriculum content** | **not started — 0 of 36 lessons** |

## Start here

```bash
# 1. Fix the workspace install first. It is currently broken.
pnpm install                 # do NOT pipe to tail; that masks the exit code

# 2. Confirm the content gate still passes
node --import tsx packages/content-tools/tests/gate-harness.mjs

# 3. See what the release is missing
pnpm content:validate -- --target v1
```

Step 3 will fail naming `curriculum/chapters/v1-ch01.json`. That is the intended
signal: the manifest lists the twelve chapter files the content wave must author.

## The three things most likely to bite you

### 1. The root install is broken

`node_modules/` contains `.pnpm/` but **no `.modules.yaml` and no package
links** — the install downloaded packages and never linked them. It reported
success only because the original command piped through `tail`, which returns
`tail`'s exit code rather than pnpm's.

As a workaround this workstream created verification-only junctions:

```
packages/content-tools/node_modules/{zod,typescript,@devpractice/contracts}
packages/contracts/node_modules/zod
```

They are gitignored and harmless — a clean `pnpm install` overwrites them — but
they are **not** a substitute for a working install.

### 2. Docker hangs on this machine

`docker version` timed out with no output. That blocked every PostgreSQL-backed
check: M02 and M03 could not be run at all. If you have a working PostgreSQL,
those two missions are the highest-value thing to verify, because they are
written but unproven.

### 3. Everything is slow

A single vitest file takes about 160 seconds here. Run long checks in the
background and poll rather than assuming they hung.

## What the content gate guarantees

`dp-content` refuses to publish content that would teach badly:

- The reference solution must pass every case.
- The starter must **fail** at least one case — otherwise there is nothing to
  practise. The only exception is an explicit read-only worked example declared
  with a reason in `curriculum/verification.json`.
- Plausible wrong implementations must be **rejected**. Constant returns,
  identity, accept-everything filters and input-mutating variants are generated
  automatically and run through the same runner contract as the real solution.

The harness proved its worth on first run by failing: the input-mutating mutant
pushed an element and then popped it, so it never actually mutated and
`assertInputUnchanged` was never exercised. That is the class of bug this gate
exists to catch, and it caught one in its own tooling.

**Caveat:** the gate currently runs on the `node:vm` build-time fallback because
`packages/runner` was still being built. The adapter prefers
`@devpractice/runner/node`. **Re-run the gate once that lands**, so authored
content is verified by the same engine the learner uses.

## Authoring the curriculum (the main remaining work)

Read [content-authoring.md](content-authoring.md), then copy
`curriculum/fixtures/valid-chapter.json` as a shape reference.

One chapter at a time, in this order: objectives and exercise inventory → lesson
bodies → solutions and behavioural cases → distractors, misconceptions and
references. Run the gate after every chapter. Volume must not run ahead of a
demonstrated grader.

Per chapter: 3 lessons, 9 exercises, 6 review cards, 1 five-item assessment.
Across V1: ≥20 runnable function tasks, ≥24 debugging or code-review tasks, ≥12
rubric explanations. Placement items must be separately authored, never copies of
lesson exercises — the gate rejects duplicates.

Write each chapter to `curriculum/chapters/v1-chNN.json` as `{ "items": [...] }`.
It is already listed in `curriculum/release.json`.

## Missions

| Mission | Port | Verified |
| --- | --- | --- |
| M01 support desk web (React, mock adapter) | 5174 | **yes — A13 fully verified** |
| M02 persistent ticket API (Fastify + Prisma) | 3101 / db 5441 | **no** — Docker unavailable |
| M03 ownership defect (repair) | 3102 / db 5442 | **no** — Docker unavailable |

M01's A13 run: baseline 8/8 pass on the starter; mission checks fail 9/9, each
because a feature the learner must build is missing (not a timeout, not an
environment error); reference solution passes 17/17; starter then restored.

Running it caught two real defects that inspection would have missed — jest-dom
matchers silently not registering, and a 5 s default timeout that made a slow
machine look like a failing assignment. Both are fixed. This is the argument for
actually executing A13 on M02 and M03 rather than trusting the code.

Each mission has `starter/` and `solution/`. The solution replaces
`starter/src/`; M02 and M03 differ from their starters in exactly one file,
`src/routes/tickets.ts`.

M03's planted defects, so a reviewer can confirm they are still present:

1. `GET /tickets/:id` has no ownership check **and** includes the owner record,
   leaking another dispatcher's display name.
2. `GET /tickets/:id/comments` has no ownership check.
3. `POST /tickets/:id/comments` has no ownership check.
4. `PATCH /tickets/:id` *does* check, but answers 403 with a message naming the
   owner and the customer — violating the documented 404 policy and leaking the
   very data the check protects.
5. `GET /tickets` is correctly scoped, which is what makes the inconsistency
   realistic rather than obvious.

## Rules that must not be quietly dropped

- **No runtime LLM call anywhere in the core product.** No inference client,
  credential or provider request exists in the repository. Keep it that way.
- **Learner code never reaches host `eval`, `new Function`, or the server.**
- **A Web Worker alone is not a security boundary.** The interpreter is.
- **No last-write-wins.** Conflicts preserve both texts.
- **Never reuse a content version number with different bytes.**
- **Browser results are client-reported; mission outcomes are self-reported.**
  Label them that way. See [known-limitations.md](known-limitations.md).
- **Do not weaken a test to make a defect pass.** Check the requirement first.

## Reporting

Use specification §1.3 labels: implemented, verified, content authored, content
validated, deferred, blocked. A screenshot proves layout, not persistence. A
passing reference solution proves one implementation works, not that the grader
rejects wrong ones. Never claim a check passed unless you ran it or its evidence
exists.
