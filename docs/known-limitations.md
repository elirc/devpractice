# Known limitations

Written to be read before anyone claims more for this system than it delivers.
Every statement here is a deliberate design boundary, not a defect to be fixed
quietly.

## Browser exercise results are client-reported

Code exercises run in the learner's own browser, inside a QuickJS-WebAssembly
interpreter in a dedicated Web Worker. The interpreter and the absence of
exposed host capabilities are what stop learner code reaching the application;
a Web Worker alone is not a security boundary.

What that buys us is isolation from the *application*. What it does not buy is
tamper resistance. The test cases are delivered to the browser and are
inspectable, and a technically skilled owner can alter what the client reports.
Attempts carry `gradingOrigin: 'browser_automated'` precisely so this is visible
in the record.

**Do not treat this as proctoring or certification.** It is personal learning
feedback for a single-owner application.

## Project outcomes are self-reported in V1

The platform does not clone repositories, does not run mission code, and does
not verify a commit hash. A mission completion stores what the owner reported:
a checklist, an optional repository URL, an optional commit hash, the test
command they say they ran, and the outcome they say they saw.

Mission records carry `gradingOrigin: 'self_reported'` and the interface labels
them that way. A green mission is evidence the owner did the work, not proof.

## The retention model is a transparent heuristic

"Demonstrated" and "retained" are product heuristics chosen to be legible and
predictable, not validated measurements of competence:

- **Demonstrated** — two passing objective activities on distinct item ids, with
  no hints or solution reveal, at least one of which is application or
  debugging rather than recall.
- **Retained** — demonstrated, plus two successful due reviews on separate UTC
  dates, the second at least seven days after the first.

The review scheduler is a fixed six-step interval table (1, 3, 7, 14, 30 days,
capped at 30), not a spaced-repetition model fitted to data. It was chosen over
a learning-science library because a rule you can read in ten lines is easier to
trust, debug and change than one you cannot.

These thresholds are configurable product decisions. They are not a claim about
memory, and no research is cited in support of them.

## Placement passes do not feed concept status

Placement assessments record `ChapterPlacement` and `PlacementAttempt` rows, and
they can mark a chapter `placed_out`. They do **not** count toward a concept's
`demonstrated` status: the progress endpoint builds concept evidence only from
`Attempt` rows for exercises in the active release
(`apps/api/src/modules/progress/routes.ts:96-112`), and the placement route never
writes an `Attempt` (`apps/api/src/modules/placements/routes.ts:142-158`). A learner
who places out of a chapter will therefore see its concepts as `unseen` or
`practicing` until they pass exercises. This is narrower than specification §3.4,
which says "a different authored variant or a placement item can provide new
evidence"; it was found during a documentation review on 2026-10-06 and has not
been fixed. `docs/learning-algorithms.md` describes the rule as implemented.

## Full offline learning is deferred

Losing the connection preserves what is in the current tab and may keep a
per-owner recovery draft in IndexedDB. That is **crash recovery**, not offline
study: recovery drafts show their unsynced status, use owner-scoped keys, and
clear from visible state at logout.

You cannot read lessons, run exercises or review cards without the server.

## Browser coding supports a constrained function environment

V1 browser exercises are single-file JavaScript or TypeScript functions with
JSON-serialisable inputs and one named entrypoint. They receive no DOM, Node,
filesystem, socket, `fetch`, or storage APIs, and no imports.

HTML, CSS, React rendering, real Node APIs, network calls, filesystem work and
C# compilation are practised **locally**, in VS Code missions. Browser lessons
still teach and assess those concepts through reading, prediction and prepared
traces — they simply do not execute them.

This is not a web IDE and does not aim to become one.

## V2 and V3 are published, but the platform is only partly re-verified

V1 covers 12 chapters, 36 lessons, 108 lesson exercises, 72 review cards, 60
placement items and 3 missions. V2 adds 8 chapters and 5 missions; V3 adds 10
chapters and 4 missions. All three releases validate with the behavioural gate on
the QuickJS backend, all 12 missions are A13 verified, and V2 (409 items) and V3
(613 items) were imported and published through the API on 2026-09-11.

What has **not** happened is a full re-run of the platform gate set against the
30-chapter catalogue. After publication only the two API integration suites
(23/23, 45/45) and the content-tools suite (21/21) were re-run; the learning-core,
runner and web unit suites and the Playwright journeys still carry their V1
results. Until they are re-run, "V2 and V3 work in the product" rests on the
published data and the API suites, not on the browser journeys. See
`handoff/01-state.md` and `handoff/02-outstanding.md`.

## Two content reachability edges used to be unvalidated

The validator walked references forwards only, so two mistakes validated green
and were invisible until someone opened the app:

- a chapter that no release track listed in `chapterIds` was unreachable in
  curriculum navigation;
- a mission that no chapter listed in `missionIds` was unreachable from every
  chapter page, even though its own `chapterPrerequisiteIds` named chapters.

Both shipped broken once: all 18 V2 and V3 chapters validated while no track
listed them, and all 9 new missions validated while no chapter claimed them. In
both cases the content was complete, correct and invisible.

They are now checked. `validateReachability` in
`packages/content-tools/src/validate.ts` raises `reachability.chapter-unlisted`
and `reachability.mission-unclaimed` as errors, and
`curriculum/fixtures/invalid-chapter-unlisted.json` and
`invalid-mission-unclaimed.json` prove each one fires.

What is still **not** checked is whether a chapter's missions are the ones a
reader would expect there. A mission claimed by an arbitrary chapter passes. That
judgement stays with a reviewer.

## Asset checksums before this release were not reproducible

`dp-content assets` now computes a bundled asset's checksum by a documented
method (`packages/content-tools/src/asset-checksum.ts`) and compares it with the
manifest. The three V1 mission-starter checksums predate that tool and **cannot
be reproduced by it**; the method that produced them was not recorded. They have
been left exactly as they are, because they belong to a published release and
rewriting them would change that release's package checksum. So V1's three assets
are declared-but-unverifiable, and everything from V2 onward is verifiable. Do
not "fix" the V1 three without deciding, deliberately, to republish V1.

## The .NET mission test projects carry a known package advisory

Restoring or building any of the four .NET mission starters prints NU1903 for
`System.Security.Cryptography.Xml` 9.0.0, a high-severity advisory. It arrives
transitively through `Microsoft.NET.Test.Sdk` 17.11.1, which is a test-only
dependency and is not part of the API a learner runs. It is reported rather than
suppressed: the honest fix is to move the test SDK forward and re-run A13 for all
four missions, and that has not been done.

## Content authoring is a human-reviewed pipeline

Lessons are authored outside the application using an existing AI subscription,
validated by `dp-content`, and imported deliberately. The application makes no
runtime call to any inference provider, and it needs no AI API credential.

The validator checks structure, references, prerequisite cycles, concept
coverage, link safety, placeholder prose, grading strength and solution
behaviour. It cannot judge whether an explanation actually teaches well. That
remains an editorial review step performed by a person.

## No AI API is required, but hosting is not free

The product needs no paid inference. It does need somewhere to run: a Node
service, a PostgreSQL database with backups, a domain and TLS. Those costs
depend on the deployment the owner chooses and are not provisioned by this
repository.

## Mutation warnings include equivalent mutants

`dp-content` verifies every authored solution by rejecting deliberately wrong
variants. Two warnings survive on the current V1 release, both on `v1-e014`
(`clampPage`, lesson L05):

    verify.mutant-survived [v1-e014]  off-by-one-lt: boundary widened
    verify.mutant-survived [v1-e014]  off-by-one-gt: boundary widened

These are **equivalent mutants**, not weak test coverage. The reference solution
guards with `requested < 1` and `requested > totalPages`. Widening either
comparison to `<=` / `>=` changes behaviour only at `requested === 1` and
`requested === totalPages`, and at both of those inputs the mutated and original
implementations return the same value. No test case can distinguish them, so the
warning cannot be cleared by adding cases — the existing case set already covers
both boundaries plus zero, negative and past-the-end inputs.

The mutation site could be removed by rewriting the solution as
`Math.min(Math.max(requested, 1), totalPages)`. We deliberately have not done
that: L05 teaches branching and boundary conditions, and replacing the explicit
comparisons with a clamp helper would delete the very construct the lesson
exists to teach in order to satisfy a heuristic. The warnings are accepted and
documented instead.

### V2 and V3 add three more, all verified the same way

The first full-release behavioural run on the assembled V2 and V3 packages
produced three further survivors. Each was judged by **running the mutated
source**, not by reading it:

    verify.mutant-survived [v2-e002]  off-by-one-lt: boundary widened
    verify.mutant-survived [v3-e023]  off-by-one-lt: boundary widened
    verify.mutant-survived [v3-e023]  off-by-one-gt: boundary widened

**`v2-e002`** (`usablePrefix`, V2 chapter 13) walks the index columns with
`i < indexColumns.length`. Widening to `<=` adds one iteration in which `column`
is `undefined`; no predicate matches an undefined column, so `op` stays `null`,
the `else` branch breaks, and the count is unchanged. The mutant returns the same
answer as the solution on all seven authored cases and on every input where a
predicate names a real column. The only distinguishing input is a predicate whose
`column` is itself `undefined` — which is not a query predicate, and authoring a
case for it would test malformed input the lesson does not teach.

**`v3-e023`** (`groupCounts`, V3 chapter 3) sorts with a comparator whose two
guards are `a.key < b.key` and `a.key > b.key`. Widening either to `<=` or `>=`
changes the result only when `a.key === b.key` — and the array being sorted is
built from `Object.keys(counts)`, so **its keys are unique by construction and
the equal case can never occur**. This one is not merely undistinguished by the
current cases; it is undistinguishable in principle, for any input at all.

Neither solution was rewritten. `v2-e002` teaches how an index prefix is consumed
column by column, and `v3-e023` teaches writing an explicit comparator; replacing
either construct with a helper that happens to have no mutation site would delete
the thing the lesson exists to teach.

The general point: a surviving mutant is a prompt to inspect the case set, not
proof of a defect. Equivalent mutants are a known limit of mutation testing, and
the check that separates the two is running the mutant, not arguing about it.
