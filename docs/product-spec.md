# Personal Web Development Learning Platform — specification

**Version 1.0 · 9 September 2026 · in-repo authoritative copy**

This is the implementation contract. It records the approved requirements,
selected implementation defaults, release boundaries, curriculum inventory,
data and API contracts, testing gates and execution instructions.

It is a specification, **not** a claim that the application or the lessons have
already been built. For what is actually built and verified, see
[implementation-checklist.md](implementation-checklist.md) and
[handoff.md](handoff.md).

---

## 1. Purpose and authority

Build a private, responsive learning web application for one owner who wants
practical mid-level web application engineering skills. The lesson-and-challenge
pattern is inspired by the general shape of tools like Boot.dev, but the
content, interface design, terminology and assets are **original**. No other
product's proprietary curriculum or branding is copied.

The owner has development experience but wants stronger fundamentals,
independent problem solving, debugging, testing and engineering judgement.
Do not assume years of experience mean mastery; equally, do not force the owner
to repeat known material. Start accessible, and let the owner skip ahead or take
placement challenges.

### 1.1 What the user approved

React, TypeScript, a Node.js backend, a relational database; Node.js and
TypeScript first with C# and .NET later; browser practice plus VS Code projects;
fundamentals with skipping; pregenerated content without a paid AI API; laptop
and phone synchronisation.

Specific libraries, algorithms, content counts, endpoints and deployment
defaults are **implementation decisions** chosen to make the handoff actionable.
They are not additional user preferences. Follow them unless repository evidence
or a failed feasibility check justifies a documented adjustment, and preserve the
approved stack and product behaviour when adjusting a library.

### 1.2 Non-negotiable requirements

1. A private account synchronises progress, notes, bookmarks and browser code
   across laptop and phone.
2. All lessons, hints, solutions, rubrics and explanations are **stored
   content**. No runtime LLM call anywhere in the core product.
3. Existing AI subscriptions author content **outside** the app. Never scrape
   subscription sessions, store subscription credentials, or treat a
   subscription as an API entitlement.
4. Browser exercises and VS Code assignments are both first-class.
5. The main sequence is JavaScript/TypeScript → React → Node.js → SQL and
   production practice → C# and .NET.
6. Skipping stays available. Completion, placement evidence, assistance used and
   retained understanding are **distinct records**.
7. Mixed projects: new features, extending existing code, investigating defects,
   refactoring with regression tests.
8. No public registration, billing, social feed, content marketplace, live AI
   chat, or public code execution service.
9. The end product contains **real** lessons and exercises. A polished shell
   with empty chapters or duplicated filler does not satisfy this specification.

### 1.3 Completion language

Use precise labels: **implemented**, **verified**, **content authored**,
**content validated**, **deferred to V2/V3**, or **blocked** with a concrete
reason.

- A screenshot proves layout, not persistence.
- A green reference solution proves one implementation passes, not that the
  grader rejects incorrect ones.
- A client-reported pass is learning feedback, not a proctored certificate.

---

## 2. Outcomes and release boundaries

### 2.1 Success scenarios

- **A** — Reads a lesson on the phone, answers two questions, writes a note,
  bookmarks a concept. On the laptop, after signing in and refreshing, the same
  progress and note appear. Completes a browser exercise, reveals a hint, and
  sees an assisted completion recorded **once**.
- **B** — Opens a VS Code mission, downloads a versioned starter, runs baseline
  checks, implements, runs mission checks. The app stores the completion report
  and optional repository URL, clearly labelled **self-reported**.
- **C** — Imports a corrected content package. Preview identifies changed and
  new items. Publication activates atomically. Existing attempts still point at
  the versions they used; notes and bookmarks stay attached to stable item ids.
- **D** — Two devices edit the same note. The stale save receives a conflict,
  both texts are preserved, the owner chooses or merges. A network retry never
  duplicates completion credit, review history or XP.
- **E** — Opens a chapter out of order. Prerequisites are explained but entry is
  permitted. A placement challenge can mark objectives placed out; opening a
  chapter or clicking skip creates **no** mastery evidence.

### 2.2 Release inventory

| Release | Platform and content |
| --- | --- |
| **V1** | Full core platform; 12 chapters, 36 lessons, 108 lesson exercises, 72 review cards, 12 placement assessments (60 items), 3 support-desk missions |
| **V2** | +8 chapters, +24 lessons, +72 exercises, +48 cards, +8 assessments (40 items), +5 missions |
| **V3** | +10 chapters, +30 lessons, +90 exercises, +60 cards, +10 assessments (50 items), +4 .NET missions |
| Later | Next.js, Angular, advanced previews, offline learning, stronger local verification |

Combined V1–V3: 30 chapters, 90 lessons, 270 lesson exercises, 180 cards, 150
placement items, 12 missions. Placement items and review cards are **not**
counted as lesson exercises. These are authored minimums, not proof of quality.
The architecture must accommodate 1,000 lessons and 10,000 exercises without
loading all content at once.

### 2.3 Deferred

Live AI tutoring, voice coaching, browser execution of arbitrary npm projects,
browser .NET compilation, arbitrary shell execution, multiuser organisations,
leaderboards, subscriptions, a custom VS Code extension, automatic GitHub write
access, sophisticated adaptive models, a vector database, microservices.

The app must not market account synchronisation as zero-cost hosting. No AI API
cost is required; hosting, storage, domain and identity costs depend on the
deployment. Do not provision paid services without authorisation.

---

## 3. Learning model

### 3.1 Hierarchy

Track → chapters. Chapter → three lessons, a placement assessment, mission
links. Lesson → 1–3 objectives, explanation, worked example, three exercises,
review cards. Missions apply multiple concepts to a business repository.

Concept ids are stable and technology-aware (`js.array-filter`, `ts.narrowing`,
`http.status-codes`, `sql.transactions`, `dotnet.dependency-injection`). Shared
concepts such as `auth.resource-ownership` appear in several tracks. The
prerequisite graph guides recommendations and **never blocks navigation**;
cyclic prerequisites are rejected at validation.

### 3.2 Lesson structure

Business context, observable objectives, plain-language explanation, annotated
example, three practice activities, common mistakes, concise summary, two
retrieval cards, and source references where behaviour is externally documented.
Explanations target 5–10 minutes; exercises 2–15. These are estimates, not
enforced timers.

Progression: **recognise → explain → apply → debug → transfer.** Multiple-choice
distractors must represent plausible misconceptions and carry answer-specific
explanations.

### 3.3 Exercise types

| Type | Grading |
| --- | --- |
| Single/multiple choice | server checks stable option ids; multiple = exact set equality |
| Predict output | explicitly defined normalisation |
| Code reading / bug identification | objective portion checked; explanation by rubric |
| JS/TS function | bounded browser interpreter, structured case comparison |
| Short explanation / design review | criteria and model answer after submission; owner self-assesses — no fake automated semantic grading |
| Local project task | real toolchain in VS Code; checklist, notes, repo reference, self-reported results |

V1 SQL exercises are code reading, query reasoning and local database tasks. Do
not pretend a browser SQLite runner reproduces PostgreSQL or SQL Server. HTML,
CSS, React rendering, real Node APIs, network calls, filesystem use and C#
compilation are practised locally; browser lessons still teach those concepts.

### 3.4 Completion and evidence

Lesson status: `not_started`, `in_progress`, `completed`, `skipped`. Completion
requires reading acknowledgement plus a passing result on each required
objective exercise; rubric activities require a self-assessment. A chapter may be
`placed_out` without completing its lessons.

Exercise evidence records outcome, assistance (`none`/`hints`/`solution_viewed`),
grading origin (`server_objective`/`browser_automated`/`self_reported`), content
version and time. Lifetime reveal history is retained.

> If a reference solution has ever been revealed for the same exercise and
> mastery revision, later passes on that item are **not** fresh independent
> evidence, even after an editor reset. A different authored variant or a
> placement item can provide new evidence. Old assisted attempts are never
> erased.

Concept status: `unseen`, `practicing`, `demonstrated`, `retained`,
`review_due`. **Demonstrated** = two passing objective activities on distinct
item ids, no hints or solution reveal, at least one application or debugging
rather than recall. Browser checks qualify but keep their origin label;
self-assessed design responses alone do not. **Retained** = demonstrated plus two
successful due reviews on separate UTC dates, the second ≥7 days after the
first. Overdue moves retained → review_due without deleting history.

These are configurable product heuristics, not validated measurements.

### 3.5 Placement

Five separately authored items per chapter covering all objectives. No hints or
solutions until submission. Qualification = ≥4 of 5 correct **and** every
critical item passing. Include at least one application, code-reading or
debugging task, using a browser coding task where the concepts fit.

Passing grants `placed_out` and separate placement evidence. It does not claim
every exercise was completed or the material retained. After answers are
revealed, repeat attempts on that version are practice only. Manual skipping
remains available regardless of score.

### 3.6 Review scheduling

Steps 0–5 with intervals 1, 3, 7, 14, 30 days, capped at 30, measured from
server acceptance time. `good` +1 step; `easy` +2 (cap 5); `hard` same step, +1
day; `again` → step 0, +10 minutes.

Cards are introduced on first lesson completion or by an explicit "Add to
review" action — **importing content enrols nothing**. A new card starts at step
0 and is immediately due. An incorrect objectively graded card forces `again`.
Free-recall cards are self-rated after reveal; those ratings schedule practice
but remain self-reported evidence.

Queue: overdue first, then newly introduced, visible batch 20 with explicit
continue, **no daily cap**. A repeated event id returns the original result; a
stale card revision receives a conflict.

### 3.7 Gamification

10 XP for a first accepted pass per lesson-exercise mastery revision (assisted or
not); 20 for first lesson completion; 50 for first mission completion. Nothing
for opening pages, retries, imports, repeated review clicks, manual skips, or
placement alone. Unique award keys prevent duplication.
`level = floor(totalXP / 250) + 1`. Lessons are never gated behind XP. Streaks
are deferred.

---

## 4. User experience

Working title **DevPractice**, changeable through one configuration field. A
quiet developer workspace: neutral background, high-contrast text, one restrained
accent, visible state labels. No excessive badges, animations, gradients or
decorative dashboards. CSS Modules and custom properties; Tailwind not needed.
Light and dark themes, system default. Respect reduced motion. **Never
communicate correctness through colour alone.**

Navigation: desktop sidebar; mobile Today / Learn / Review / Projects / More
(Progress, Notes, Content, Settings).

Routes: `/login`, `/today`, `/learn`, `/learn/chapters/:id`,
`/learn/lessons/:id`, `/practice/:exerciseId`, `/placement/:chapterId`,
`/review`, `/projects`, `/projects/:missionId`, `/progress`, `/notes`,
`/content`, `/settings`.

**Lesson workspace** — desktop: explanation + practice panels; mobile:
Instruction / Practice / Results tabs preserving input. Code blocks scroll inside
their container; the page never overflows. Save indicator: Saving / Saved /
Unsaved / Conflict — never "Saved" before server acknowledgement. Hints reveal in
order; the solution needs an explicit action noting the attempt will be recorded
as solution-assisted, without a blocking modal per hint. Reset starter confirms
and creates a recoverable snapshot.

**Project workspace** — business context, expected outcome, relevant files,
pinned starter version, setup commands, baseline checks, acceptance criteria,
progressive hints, solution explanation, completion form. The app never clones a
private repository or runs code from a supplied URL.

**Accessibility** — 360 CSS-px viewport without page-level horizontal scrolling
(code containers excepted), ≥44×44 px touch targets, semantic headings, explicit
labels, visible focus, accessible status messages, correct dialog focus. The
editor must not trap focus and needs a textarea fallback. Check contrast against
WCAG AA rather than assuming.

---

## 5. Architecture defaults

pnpm workspace monorepo · React + TypeScript strict + Vite + React Router ·
Node.js LTS + Fastify with explicit request validation · PostgreSQL + Prisma ·
TanStack Query · Zod · CSS Modules · CodeMirror (practice routes only, textarea
fallback) · **QuickJS compiled to WebAssembly in a dedicated Web Worker** ·
Vitest + React Testing Library + API integration tests against PostgreSQL ·
Playwright · Docker Compose for local PostgreSQL · one Node service serving the
built frontend and `/api`.

Node.js 22/24 LTS baseline; a supported .NET LTS for V3. Pin tested versions;
never write unverified patch numbers into the specification.

**Module boundaries** — `apps/web` (routes, components, editor, workers),
`apps/api` (auth, access, publication, persistence, scheduling, exports),
`packages/contracts` (shared static schemas and DTOs), `packages/content-tools`,
`packages/learning-core` (pure rules), `packages/runner`, `prisma`,
`curriculum`, `projects`, `docs`.

API feature modules: auth, curriculum, attempts, progress, reviews, notes,
missions, imports, exports. Handlers validate and delegate; transactions live at
the service boundary. **Do not add** generic repository wrappers, an event bus,
CQRS infrastructure, Redis, or a multi-database abstraction without a
demonstrated requirement. The platform database is separate from every
learning-project database.

Fastify's compiled route schemas must be application-authored. Imported course
data is validated by the fixed content schema and **never** becomes executable
route-validator code. TypeScript strict; no broad `any` or `ts-ignore`.

---

## 6. Authentication

One bootstrap owner account, password plus database-backed sessions. No public
signup. Local admin commands create the owner (interactive prompt or injected
secret — never logged, committed, or passed as visible argv) and reset the
password while revoking sessions. Email recovery deferred.

Argon2id with parameters from current library and OWASP guidance. Never invent
cryptography. Cryptographically random opaque session token; store only its
hash. Cookie: HttpOnly, Secure in production, SameSite=Lax, host-only, `Path=/`,
`__Host-` prefix in HTTPS production. **No tokens in localStorage.**

Sessions: 30-day absolute, 7-day idle; `lastSeenAt` updated at most once per five
minutes. Login creates a token; logout revokes it; reset and revoke-all revoke
all. Generic authentication failures; default 5 failed attempts per 15 minutes
per account and source address; no permanent lockout.

Every data route requires authentication and ownership checks. The runner
receives only exercise material — never the session token or authenticated API
wrappers. Every authenticated state-changing request checks Origin and a
session-bound CSRF token; login validates Origin and a short-lived pre-session
token from `GET /auth/csrf`. SameSite is defence in depth, not the whole control.
Serve frontend and API from one origin.

An expired session leaves unsaved editor text visible. **Never destroy drafts
during an authentication failure.** Validate every object id against owner scope
and test with a second synthetic user.

---

## 7. Browser execution

V1 code exercises are single-file JS/TS functions with JSON-serialisable inputs,
one named entrypoint, static test data, no arbitrary imports, and **no** DOM,
Node, filesystem, socket, fetch, storage or platform access.

QuickJS provides an interpreter boundary inside a dedicated Web Worker. Learner
source is passed to the interpreter, never to host `eval`, `new Function`, a
generated module, or the main window. **A Web Worker alone is not the security
boundary** — the interpreter and the absence of exposed host capabilities are.

Fresh runtime per run, disposed after. Expected results and comparison logic stay
in trusted worker code; never inject a mutable test-result object. A technically
skilled owner can still alter client reports: never describe this as tamper-proof
or use it for certification.

**TypeScript** uses a virtual single-file compiler with bundled declarations, and
runs syntactic **and semantic** diagnostics before emitting. A type error returns
`compile_error` and can never pass. Transpiling types away does not satisfy TS
grading.

Limits: 10 s initialisation (visible loading state, Retry), 2 s execution, 64 KiB
source, ≤25 cases, 64 KiB input/output, ≤100 console lines, 16 KiB console.
Interpreter memory and stack limits plus an outer worker watchdog.

Messages carry `protocolVersion`, `runId`, ids, source, language, entrypoint and
limits; responses carry status (`passed`, `failed`, `compile_error`,
`runtime_error`, `timed_out`, `cancelled`, `unsupported`), duration, diagnostics,
bounded console and case results. Accept responses only from the active worker
and matching `runId`. Errors display as text, never injected HTML.

**Proof required before release** — correct function, incorrect boundary, syntax
error, TS type error, thrown exception, recursion, infinite loop, oversized
output, excessive allocation, attempted host access, repeated runs, cancellation,
stale responses; the app stays usable and no authenticated request originates
from learner code. Repeat in Chromium, Firefox and WebKit. If bounded execution
cannot be demonstrated, the gate stays incomplete — **do not fall back to
main-thread eval.**

---

## 8. Data model

PostgreSQL `timestamptz`, server-generated UTC timestamps, UUIDs for operational
records, stable strings for authored content. Never depend on a client clock for
ordering. Database constraints as well as application validation.

Core tables: `User`, `Session`, `ContentItem`, `ContentVersion`,
`ContentRelease`, `ReleaseItem`, `Concept`, `Attempt`, `RevealEvent`,
`LessonProgress`, `PlacementAttempt`, `ExerciseDraft`, `DraftSnapshot`,
`ReviewState`, `ReviewEvent`, `Note`, `Bookmark`, `MissionProgress`, `XpAward`,
`ActivityEvent`, `MutationReceipt`. Full detail in
[data-model.md](data-model.md).

Attempts point at immutable `ContentVersion` rows; lessons, drafts, notes and
bookmarks point at stable `ContentItem` ids. A published release is an immutable
id → version map; `activeReleaseId` changes inside the publishing transaction.
In-flight attempts may finish against their loaded version, with a
content-updated notice afterwards.

Editorial changes increment `version` and preserve `masteryRevision`; behavioural
changes increment `masteryRevision`, keeping old evidence visible while new
practice earns its own. Removing content archives it — notes, bookmarks and
attempts survive. Rollback selects an earlier release and deletes nothing.
Never recycle a version number with different bytes.

`ActivityEvent` is a feed, not event sourcing. Concept status is **derived**, not
stored as an independently editable field.

---

## 9. API and synchronisation

JSON over same-origin HTTPS under `/api/v1`. `{ data, meta? }` and
`{ error: { code, message, fieldErrors?, requestId } }`. Statuses: 400, 401, 403,
404, 409 (revision/idempotency/release), 413, 422, 429, 500. Opaque cursors over
a stable sort key, default 20, max 100.

Every learning and content mutation carries a `clientEventId` UUID. Same id and
body → original result; same id, different body → `IDEMPOTENCY_CONFLICT`. Receipt
and domain change share one transaction; failed validation stores no success
receipt.

Full endpoint inventory in [api.md](api.md).

`GET /exercises/:id` omits solution fields; reveals come from
`POST /exercises/:id/reveals`. The server derives userId, assistance, accepted
case ids, XP and timestamps, and never trusts supplied ownership, XP or mastery.
Browser outcomes are stored as client-reported automated evidence; learner source
is never executed on the server.

**Save semantics** — autosave after 1 s idle, one in-flight write per document,
each with `expectedRevision`. Queue the newest text after acknowledgement rather
than sending stale concurrent writes. On conflict, retain local text, show server
text with timestamps, offer Keep server / Save mine / Merge. **No
last-write-wins.** A stale DELETE also conflicts.

Completion is monotonic. Refresh on focus and reconnect; poll Today and progress
every 30 s while visible. Cross-device updates appear within 30 s or immediately
on focus. WebSockets unnecessary for V1. Connection loss shows Unsaved; an
optional IndexedDB recovery draft is crash recovery, not offline learning.

---

## 10. Content packages

Versioned JSON envelope with Markdown strings. Raw HTML disabled, safe link
policy. **No MDX, imported components, scripts or embedded expressions.** V1
uploads: a single JSON file ≤10 MiB, ≤2,000 items.

Envelope: `schemaVersion`, `packageId`, `packageVersion`, `baseReleaseId`,
`mode`, `title`, `items`, `assets`. V1 accepts `mode=snapshot` — a complete
desired release manifest. Adding a chapter means re-assembling all chapters into
a new snapshot; the UI must explain this so a partial file is not mistaken for a
whole replacement.

Items are a discriminated union: track, chapter, lesson, exercise, review_card,
assessment, mission. Shared fields: `id`, `version`, `masteryRevision`, `title`,
`conceptIds`, `prerequisiteIds`, `bodyMarkdown`. Stable ids are lowercase
letters, digits and hyphens up to 80 characters; concept ids also permit dots.

Runtime fields (`ownerId`, progress, XP, `publishedAt`) are forbidden in authored
payloads. Unknown fields and unsupported schema versions are **reported, never
silently ignored**. Exercise variants get their own stable ids.

Each of three hints must add information: conceptual direction, relevant
mechanism, near-solution guidance. Grading definitions are static data, never
host code.

**Validation** covers schema shape, unique ids and versions, allowed kinds,
required fields, valid references, prerequisite cycles, sequence ordering,
concept coverage, duplicate fingerprints, broken asset references, supported
runner features, correct answers, solution behaviour and expected starter
behaviour. A code starter normally fails at least one case; an explicit read-only
worked example is the documented exception.

The CLI runs reference functions and deliberate incorrect variants through the
same runner contract. The production import endpoint **never** runs package
scripts or shell commands — structural validation and bounded checks only.
Project-solution verification is a separate build-time gate.

Publication requires an explicit owner action, a matching checksum and an
unchanged base release; a competing publication returns 409. Publication writes
versions, membership rows and the active pointer atomically. Reject
`javascript:`/`data:` links, path traversal and unknown assets.

**Authoring workflow** — one chapter at a time: approve objectives and exercise
inventory, then lesson bodies, then solutions and cases, then distractors,
misconceptions and references. Volume must not run ahead of a stable schema and a
demonstrated grader. No live inference endpoint is required.

Details: [content-authoring.md](content-authoring.md).

---

## 11. V1 curriculum inventory

36 lessons, each with exactly three required exercises, two review cards, and
membership in one chapter assessment.

| Chapter | Lessons |
| --- | --- |
| 1 Web workflow | L01 request/response · L02 Git and project commands · L03 debugging from evidence |
| 2 JS values and control flow | L04 values and coercion · L05 branching and boundaries · L06 functions and scope |
| 3 Records and collections | L07 objects and immutable changes · L08 array selection and transformation · L09 lookup and aggregation |
| 4 Async and HTTP | L10 promises and async/await · L11 requests and status codes · L12 failures and cancellation |
| 5 TypeScript | L13 types and nullability · L14 unions and narrowing · L15 interfaces and reusable functions |
| 6 Web interface fundamentals | L16 semantic HTML and forms · L17 CSS layout and responsiveness · L18 accessibility states |
| 7 React fundamentals | L19 components and props · L20 state updates · L21 effects and derived state |
| 8 React forms and API data | L22 controlled forms · L23 server data · L24 accessible feature composition |
| 9 Node.js APIs | L25 route boundaries · L26 runtime validation · L27 errors and contracts |
| 10 Relational persistence | L28 data modelling · L29 queries and pagination · L30 migrations and transactions |
| 11 Authentication and permissions | L31 identity vs access · L32 resource ownership · L33 safe request handling |
| 12 Verification and operation | L34 meaningful testing · L35 logs and configuration · L36 shipping and maintenance |

**Diversity minimums** (categories overlap): ≥20 runnable JS/TS function tasks,
≥24 debugging or code-review tasks, ≥12 short explanations with a rubric. Do not
silently convert everything to multiple choice to hit the count.

Review cards: one recall plus one transfer/code-reading/debugging card per
lesson. Placement items are **separately authored**, never copies of lesson
exercises. Every chapter references official documentation where external
behaviour matters.

---

## 12. Expansion curriculum

**V2 (8 chapters)** — N13 persistence depth · N14 transaction correctness ·
N15 API evolution · N16 background work · N17 security depth · N18 integration
testing · N19 frontend depth · N20 operations and review. External-service
fixtures cover success, timeout, malformed response, duplicate webhook and retry.
Redis, queues and cloud services appear only in optional comparisons.

**V3 (10 chapters)** — D01 C# fundamentals · D02 modelling · D03 LINQ ·
D04 asynchronous C# · D05 ASP.NET Core · D06 EF Core · D07 data correctness ·
D08 security · D09 testing · D10 operation and comparison. C# executes locally
with a pinned .NET SDK. Use PostgreSQL for default .NET projects to isolate
language differences; add a SQL Server/T-SQL comparison later. Distinguish LINQ
over in-memory collections from EF Core translation. Do not teach legacy ASP.NET
as the modern default.

**Optional** — Next.js and Angular extensions after Node and .NET goals work.
Neither belongs in the V1 dependency graph.

---

## 13. Project missions

Each mission ships a reproducible starter snapshot and a separately identified
reference solution, with its own README, lockfile or SDK pin, environment
example, seed data, baseline tests, mission tests and troubleshooting.
**Never invent commit hashes.**

Baseline checks verify the starter runs. Mission acceptance tests are expected to
**fail** before the work, under a separate named command, so an intentionally
incomplete assignment is distinguishable from a broken setup. Reference solutions
pass both.

Users, tickets and business records are clearly fictional. An intentional defect
lives only in the training repository, never in the platform. No real
credentials or destructive integrations. A fresh checkout must reproduce the
defect before the solution is revealed.

- **M01** — build a support ticket interface on a React scaffold with a mock API
  adapter.
- **M02** — extend it into a persistent Node + PostgreSQL + Prisma ticket API and
  connect M01 through its adapter. Authentication is **not** claimed complete;
  identity fixtures are explicit training scaffolding.
- **M03** — repair an ownership defect: a route fetching a ticket by id without
  an ownership check. Security regression tests fail first. A UI-only restriction
  does not pass.

V2/V3: M04 search and cursor pagination · M05 N+1 investigation · M06 inventory
build · M07 duplicate order idempotency · M08 retryable background job ·
M09–M12 .NET equivalents and comparison. Make delivery guarantees explicit;
never label a retrying system "exactly once" without defining the boundary.

---

## 14. Testing and quality gates

Unit tests for scheduling, evidence, XP uniqueness, grade comparison and content
diff classification. API integration tests against a **real** disposable
PostgreSQL. Component tests for interactive states and accessible forms. A small
set of Playwright journeys. Do not replace persistence tests with mocked
repositories and then claim synchronisation works.

Deterministic fixtures and controlled clocks. No dependence on external AI
services or a production database. A test that asserts copied implementation
constants is insufficient. Avoid brittle whole-page snapshots.

Acceptance scenarios A01–A18 are listed in [testing.md](testing.md). Do not
weaken a test to accommodate a defect without first checking the requirement.

Performance targets (documented environment, not guarantees): p95 under 500 ms
for Today/curriculum/progress on a seeded 1,000-lesson catalog; visible content
within 3 s on simulated fast 4G; initial compressed JS under 300 KiB with editor,
compiler and interpreter lazily loaded. A missed target is recorded with its
measurement and cause.

---

## 15. Deployment and operations

See [operations.md](operations.md) for the configuration contract, logging rules,
backup and restore runbook, and the release procedure.

Local: web, api and disposable PostgreSQL. Production: one containerised Node
service plus PostgreSQL, HTTPS, persistent storage, daily backups, frontend and
`/api` on one origin. Choose a host when implementation reaches deployment;
provider choice does not change the application contract. Do not create paid
accounts merely because a provider appears in an example.

Back up before migrations. Prefer additive migrations; never automatically drop
learner history. Roll back application code only when database compatibility is
known; restoring a backup is a **distinct recovery action with possible data
loss**.

---

## 16. Implementation backlog

Ordered by dependency, not calendar estimates. Every ticket needs an
owner-visible result, a verification record, and an updated status in
[implementation-checklist.md](implementation-checklist.md).

- **P0** foundations — repository assessment, toolchain, **runner feasibility
  spike**, contract fixtures. Exit: reproducible environment, proven bounded
  runner, valid content schema, recorded ADR. Not a usable course.
- **P1** first complete journey — auth, navigation and catalog, exercises and
  reveals, attempts and completion. Exit: sign in, read one real lesson,
  complete mixed exercises, refresh, see durable progress on a second browser.
- **P2** sync and evidence — drafts and notes, evidence and placement, review
  engine, Today and progress.
- **P3** projects and content ops — mission workflow, support-desk repositories,
  content CLI, import and publication UI.
- **P4** curriculum production — chapters 1–4, 5–8, 9–12, editorial review.
- **P5** hardening and V1 release — end-to-end verification, export and recovery,
  production packaging, handoff.
- **P6** V2 Node expansion · **P7** V3 .NET expansion.

Do not proceed past P0-03 by substituting unsafe host eval. Do not call V2 or V3
complete when only V1 exists.

---

## 17. Documentation

The repository teaches how it works: [codebase-tour.md](codebase-tour.md),
[learning-algorithms.md](learning-algorithms.md),
[content-authoring.md](content-authoring.md), [api.md](api.md),
[data-model.md](data-model.md), [testing.md](testing.md),
[operations.md](operations.md), [known-limitations.md](known-limitations.md),
and short ADRs in `docs/decisions/`.

Provide concise decision summaries and evidence, not internal chain-of-thought.
**Do not fabricate a deliberation transcript or a multi-agent review.** If a
second model reviews the work, record its actual findings and the resulting
fixes. Commands must run, filenames must exist, examples must use pinned
dependencies.

---

## 18. Prompts

Kickoff, continuation, chapter generation and implementation review prompts are
kept with the original specification document. The operative instruction for any
resuming model is in [handoff.md](handoff.md): read the checklist, verify the
present state before changing it, resume at the next incomplete ticket, and never
claim earlier checks passed unless their evidence exists or the check is re-run.

---

## 19. Definition of done (V1)

1. Owner sign-in and protected routes work in production mode.
2. Curriculum, lesson, practice, review, project, progress, note, content and
   settings flows are functional with persisted data.
3. Code exercises use the proven bounded runner and type checking; unsupported
   workloads lead to local assignments.
4. Cross-device changes converge, conflicting text is preserved, retries do not
   duplicate learning events or XP.
5. Reveals affect evidence accurately; skip, placement, completion and retention
   remain distinct.
6. Content packages validate, preview, publish atomically, preserve history and
   support prior-release activation.
7. All 36 lessons, 108 exercises, 72 cards, 60 placement items and 3 runnable
   missions exist.
8. Platform tests, content checks, starter and solution checks, mobile
   inspection and a backup restore have passed.
9. No AI API credential is necessary. Hosting configuration and access
   limitations are documented.
10. Setup, architecture, authoring, operations and continuation instructions
    match the implemented repository.

---

## 20. References

Consult the current official version during implementation, pin tested versions,
and record deviations.

- Node.js releases — <https://nodejs.org/en/about/previous-releases>
- .NET support — <https://learn.microsoft.com/en-us/dotnet/core/releases-and-support>
- Fastify validation — <https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/>
- TypeScript `strict` — <https://www.typescriptlang.org/tsconfig/strict.html>
- quickjs-emscripten — <https://github.com/justjake/quickjs-emscripten>
- OWASP session management — <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>
- OWASP CSRF prevention — <https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html>
- MDN iframe sandbox — <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe>
- Prisma transactions — <https://www.prisma.io/docs/orm/fundamentals/transactions>

The curriculum, counts, algorithms and release design are original planning
decisions, not claims sourced from these references.
