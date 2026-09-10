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

## V1 is a foundation course; V2 and V3 are not built

V1 covers 12 chapters, 36 lessons, 108 lesson exercises, 72 review cards, 60
placement items and 3 missions. That is a broad foundation across JavaScript,
TypeScript, React, Node.js, SQL, authentication and operations.

It is **not** comprehensive Node.js expertise, and it contains no C# or .NET at
all. Production depth (V2) and the .NET curriculum (V3) are specified in the
backlog and are explicitly not delivered. Any report that describes the whole
Node and .NET curriculum as complete is wrong.

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

The general point: a surviving mutant is a prompt to inspect the case set, not
proof of a defect. Equivalent mutants are a known limit of mutation testing.
