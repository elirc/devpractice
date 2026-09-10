# ADR 0001 — Architecture baseline

**Status:** accepted
**Date:** 2026-09-09

## Context

A single-owner learning platform with browser exercises, VS Code missions,
cross-device synchronisation, and content that must be correctable without
destroying learning history. The approved stack is React, TypeScript, a Node.js
backend and a relational database. No runtime LLM call is permitted anywhere in
the core product.

## Decisions

### A modular monolith, not services

One Fastify service owns auth, content publication, learning records and static
hosting; feature modules inside it hold their own routes and services. There is
one owner and one deployment. Splitting this into services would add network
failure modes and distributed-transaction problems in exchange for scaling we do
not need.

Rejected alongside it: generic repository wrappers, an event bus, CQRS, Redis,
and a database-portability abstraction. Each was rejected for the same reason —
no demonstrated requirement.

### Same origin for app and API

The Node service serves the built frontend and `/api`. This keeps the session
cookie host-only, avoids credentialed cross-origin requests, and makes CSRF
defence a matter of Origin plus a session-bound token rather than a CORS matrix.

### Immutable content versions, snapshot releases

Attempts reference an immutable `ContentVersion`; notes and bookmarks reference
the stable `ContentItem` id; a published release is an immutable id → version
map activated in one transaction.

The alternative — editing content in place — makes it impossible to say what a
past attempt was graded against. Separating `version` (editorial) from
`masteryRevision` (behavioural) lets typos be fixed without invalidating
evidence, while a genuine change to required behaviour asks for new practice.

### QuickJS-WASM in a Web Worker for learner code

Learner source goes to a WebAssembly interpreter, never to host `eval`,
`new Function`, a generated module, or the main window.

A Web Worker alone was rejected: it is a concurrency boundary, not a security
one — worker code still reaches `fetch` and the origin's credentials. Running
learner code on the **server** was rejected outright: it turns a personal
learning tool into a hostile-code execution service.

The consequence is accepted honestly: results are client-reported and
inspectable, labelled `browser_automated`, and never described as tamper-proof.

### TypeScript exercises need semantic diagnostics

TS grading runs full syntactic **and semantic** diagnostics before emitting.
Transpiling types away and running the JavaScript would let a type-invalid
solution pass, which would teach the opposite of the lesson.

### A deterministic six-step review scheduler

A fixed interval table (1, 3, 7, 14, 30 days) rather than an FSRS-style library.
With one learner there is no data to fit a model to, and a rule that fits in ten
lines is easier to trust, debug and change. It is documented as a heuristic, not
as science.

### Derive concept status; do not store it

Concept status is computed from attempts, reveals and reviews. Storing it as an
editable field would create a second copy of the truth that can drift from the
evidence justifying it. A rebuildable projection can be added later if
measurement demands it.

### Idempotency by explicit client event id

Every learning mutation carries a `clientEventId`; the receipt and the domain
write share one transaction. Retries are inevitable on mobile connections, and
duplicate XP or duplicate completion credit would quietly corrupt the record.

### Optimistic concurrency, never last-write-wins

Drafts, notes, mission progress, settings and review states carry a revision. A
stale write returns 409 with the server's current text so the client can
preserve both versions. Silently discarding the loser's text is unacceptable for
a learner's own notes and code.

### Content packages are data

Imported JSON is validated by a fixed schema and never becomes executable code:
no `eval`, no MDX compilation, no npm hooks, and never a Fastify route
validator. Markdown renders with raw HTML disabled.

## Consequences

- Browser execution is bounded and honest about being client-reported.
- Content can be corrected safely; history survives edits, archival and rollback.
- Sync is conflict-preserving and duplicate-proof.
- Scaling beyond one owner, offline study, and in-browser DOM/React execution
  are explicitly out of scope for V1.
