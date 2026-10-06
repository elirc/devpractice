# Handoff

> **Status note (2026-10-06).** This file was first written on 2026-09-09, when the
> V1 curriculum had not been authored, the workspace install was broken, and
> M02/M03 had never run. All of that is resolved. The detailed, session-by-session
> handoff now lives in [`handoff/`](../handoff/README.md); this page keeps only the
> current summary and the rules that outlive any one session.

## Where the project stands (as of commit `1c391f5`, 2026-09-11)

| Area | State | Evidence |
| --- | --- | --- |
| Platform (api, web, runner, learning-core, contracts, content-tools) | implemented and verified for V1 | gate table in `handoff/01-state.md` |
| V1 content: 12 chapters, 36 lessons, 108 exercises, 72 cards, 60 placement items, 3 missions | published 2026-09-09 | `docs/final-verification.md` |
| V2 content: 20 chapters, 8 missions (409 items) | published 2026-09-11 | `handoff/01-state.md`, "V2 and V3 are PUBLISHED" |
| V3 content: 30 chapters, 12 missions (613 items) | published 2026-09-11 | same |
| Missions M01–M12 | A13 verified | `docs/missions-verification.md`, `-v2.md`, `-v3.md` |
| Content gate | runs on QuickJS, the learner's engine; 21/21 gate tests | `handoff/01-state.md` |
| Re-verification after V2/V3 publish | **partial**: API integration 23/23 and 45/45, content-tools 21/21; learning-core, runner, web unit suites and Playwright not re-run | `handoff/02-outstanding.md` §1 |
| A15 backup/restore drill | **never performed** | `handoff/02-outstanding.md` §2 |

Remaining work, in order, with commands: [`handoff/02-outstanding.md`](../handoff/02-outstanding.md).

## What the content gate guarantees

`dp-content` (`packages/content-tools`) refuses to publish content that would teach badly:

- The reference solution must pass every case.
- The starter must **fail** at least one case, unless the exercise is a read-only
  worked example declared with a reason in `curriculum/verification.json`.
- Plausible wrong implementations are generated and must be **rejected**:
  constant returns, identity, accept-everything filters, input mutation, flipped
  `===`/`!==`, widened `<`/`>` boundaries, and a `1` → `0` literal swap
  (`packages/content-tools/src/mutants.ts:56-116`). A surviving mutant is a
  warning to investigate, not an automatic failure; the five current survivors are
  explained in [known-limitations.md](known-limitations.md).
- Every chapter must be listed by the release track and every mission claimed by a
  chapter (`validateReachability` in `packages/content-tools/src/validate.ts`).

The behavioural checks run on the same QuickJS engine the browser uses.
`resolveRunner` (`packages/content-tools/src/runner-adapter.ts:258-308`) imports
`@devpractice/runner/node` and only falls back to `node:vm` with a loud
`process.emitWarning`. A validation run reports which backend it used; trust a
result only when it says `backend: quickjs (@devpractice/runner)`.

## Rules that must not be quietly dropped

- **No runtime LLM call anywhere in the core product.** No inference client,
  credential or provider request exists in the repository.
- **Learner code never reaches host `eval`, `new Function`, or the server.** The
  QuickJS interpreter is the boundary (`packages/runner/src/engine.ts`); a Web
  Worker alone is not.
- **No last-write-wins.** Conflicting edits return `409` and preserve both texts.
- **Never reuse a content version number with different bytes.**
- **Browser results are client-reported; mission outcomes are self-reported.**
  Label them that way. See [known-limitations.md](known-limitations.md).
- **Do not weaken a test to make a defect pass.** Check the requirement first.
  Several tests here asserted behaviour they never exercised (`handoff/04-gotchas.md`).

## Reporting

Use specification §1.3 labels: implemented, verified, content authored, content
validated, deferred, blocked. A screenshot proves layout, not persistence. A
passing reference solution proves one implementation works, not that the grader
rejects wrong ones. Never claim a check passed unless you ran it or its evidence
exists.
