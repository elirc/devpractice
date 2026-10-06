# Learning algorithms

Every rule in this document lives in `packages/learning-core/src` as a pure
function with an injected clock, so it can be unit-tested without a database
and without waiting for real time to pass. The API modules gather rows from
PostgreSQL and hand them to these functions.

These are **product heuristics chosen for legibility**, not validated
measurements of learning. See [known-limitations.md](known-limitations.md).

## Vocabulary that must not be conflated

Four different things are recorded separately, because they mean different
things:

| Record | Question it answers | Table |
| --- | --- | --- |
| Lesson status | Did the owner work through this lesson? | `LessonProgress` |
| Exercise evidence | What happened on this attempt, with how much help? | `Attempt`, `RevealEvent` |
| Concept status | Has this idea been demonstrated, and is it still retained? | derived on read, not stored |
| Placement | Did the owner skip this chapter by proving the objectives? | `ChapterPlacement`, `PlacementAttempt` |

Opening a chapter, skipping a lesson, and passing a placement assessment are
three different events. None of them is mastery.

## Lesson status

`not_started → in_progress → completed | skipped`

`nextLessonStatus` (`lesson-completion.ts:36-47`) encodes the transitions. Its
first line is the monotonic rule: `if (current === 'completed') return 'completed';`
— no action, including skip, moves a completed lesson anywhere else.

**Completion requires** a reading acknowledgement *and* every exercise marked
`requiredForLessonCompletion` satisfied (`checkLessonCompletion`,
`lesson-completion.ts:25-33`). An objective exercise needs a passing attempt; a
rubric exercise (`explanation`, `local-project`) needs a recorded
self-assessment instead. The API checks this against attempts at the exercise's
**current** mastery revision (`apps/api/src/modules/lessons/routes.ts:136-152`),
so passing an older revision of an exercise does not satisfy a changed one.

When a completed lesson's exercises move to a newer mastery revision, the
completion stands and the lesson shows "updated practice available"
(`apps/api/src/modules/lessons/progress-helpers.ts:53-96`). The new practice earns
new evidence; it does not rewrite the old completion.

## Exercise evidence

Every attempt records four independent facts:

- **outcome** — `passed`, `failed`, `needs_self_assessment`
- **gradingOrigin** — `server_objective`, `browser_automated`, `self_reported`
- **assistance** — `none`, `hints`, `solution_viewed`
- **content version** — the immutable version the attempt was made against

### The assistance rule

> If a reference solution has **ever** been revealed for the same
> `(exerciseId, masteryRevision)`, later passes on that same item are not fresh
> independent evidence — even if the editor is reset first.

`resolveAssistance` (`assistance.ts:51-55`) returns `solution_viewed` if any
solution reveal exists in the history for that item and revision, otherwise
`hints` if any hint was revealed, otherwise `none`. The history comes from
`RevealEvent` rows, which are never deleted, so resetting the editor cannot
change it. A new mastery revision of the same exercise starts with a clean
history (test: "does not leak assistance to a different item or a new mastery
revision").

Old assisted attempts are never erased when a later attempt succeeds. The
history shows what actually happened.

## Concept status

```
unseen → practicing → demonstrated → retained
                                       │   ↑
                              (overdue) ↓   │ (answered)
                                     review_due
```

`classifyConcept` (`evidence.ts:143-198`) derives the status every time the
progress endpoint is called; nothing is stored.

**demonstrated** (`evidence.ts:103-110`, `153-164`) requires *all* of:

1. two passing attempts whose `gradingOrigin` is `server_objective` or
   `browser_automated`,
2. on **distinct item ids**,
3. with `assistance = none` on both,
4. at least one of type `function` (application) or `code-reading` (debugging)
   rather than `choice` or `predict-output` (recall) — the mapping is
   `EXERCISE_COGNITIVE_LEVEL`, `evidence.ts:33-40`.

Self-assessed `explanation` and `local-project` work never counts.

**retained** requires demonstrated, plus two reviews that were **due** when
answered, objectively graded **correct** (`server_objective`), on separate UTC
dates, the second at least **seven days** after the first
(`findRetentionPair`, `evidence.ts:117-141`). Self-rated free-recall reviews are
counted separately (`selfRatedReviewCount`) and never satisfy retention.

A retained concept whose earliest card due date has passed becomes
`review_due` (`evidence.ts:172-180`). It deletes no history; answering the card
moves the due date forward and the concept back to `retained`. A concept that is
only `demonstrated` stays `demonstrated` when a card is overdue.

**What feeds this.** Only `Attempt` rows for exercises in the active release
(`apps/api/src/modules/progress/routes.ts:96-112`) and `ReviewEvent` rows whose
due-ness was recorded on the matching `review.answered` activity row (lines
114-139). Placement attempts are **not** included, although specification §3.4
says a placement item can provide new evidence; see
[known-limitations.md](known-limitations.md).

### Worked example

`js.array-filter`, all times UTC. Run through the real `scheduleReview` and
`classifyConcept` functions.

| Date | Event | Status after |
| --- | --- | --- |
| 01 Sep | Reads the lesson | `unseen` — reading creates no attempt |
| 01 Sep | Passes function exercise `e1` after revealing the solution | `practicing` |
| 02 Sep | Passes `e1` again after resetting the editor | `practicing` — still `solution_viewed` for that revision |
| 03 Sep | Passes a *different* `code-reading` exercise `e2`, no hints | `practicing` — one clean pass |
| 04 Sep | Passes a third exercise `e3` (a `choice` item), no hints | `demonstrated` — two distinct clean items, one of them debugging |
| 05 Sep | Answers the concept's review card correctly (card at step 0, due) | `demonstrated` — one successful review; card moves to step 1, due 06 Sep |
| 13 Sep | Answers it correctly again (8 days later, card overdue so it counts as due) | `retained`; card moves to step 2, due 16 Sep |
| 16 Sep onward | Card due and not yet answered | `review_due` |

An earlier version of this table used a placement pass on 04 Sep. Under the
current implementation that would have left the concept `practicing`.

## Review scheduling

`scheduleReview` (`review-scheduler.ts:74-110`). Every interval is measured from
**server acceptance time**, never the client clock.

The step number is where the card **arrives**; the interval is looked up for that
arrival step (`intervalDaysForStep`, `review-scheduler.ts:54-58`):

| Arrival step | 0 | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- | --- |
| Due after | now (new card) / 10 min (`again`) | 1 day | 3 days | 7 days | 14 days | 30 days |

`REVIEW_INTERVAL_DAYS` in `packages/contracts/src/domain.ts:27` is
`[1, 3, 7, 14, 30, 30]`. Only its first five entries are ever read (index =
`min(step, 5) - 1`), so the sixth `30` is unused.

| Rating | Effect |
| --- | --- |
| `again` | step → 0, due in **10 minutes** |
| `hard` | step unchanged, due in **1 day** |
| `good` | step + 1 (max 5), due per the table |
| `easy` | step + 2 (max 5), due per the table |

Rules that matter:

- A newly introduced card starts at step 0 and is **immediately due**
  (`newCardState`, `review-scheduler.ts:70-72`).
- An incorrect objectively-graded card **forces `again`**, whatever rating the
  client sent (`review-scheduler.ts:76-77`); `ratingWasForced` records that it
  happened.
- A free-recall card is self-rated after revealing the answer. Those ratings
  schedule practice but are recorded with `correctness: null` and do not count
  toward retention.
- Cards are introduced on first lesson completion, or by an explicit
  "Add to review" action. **Importing content enrols nothing.**

### Queue order

`orderDueQueue` (`review-scheduler.ts:122-129`): due cards that have been reviewed
before come first, oldest due date first; then due cards never reviewed. Ties
break on card id, so the order is deterministic. The visible batch is 20
(`DEFAULT_REVIEW_BATCH`) with an explicit continue action. There is **no daily
cap** hiding remaining work.

### Concurrency

Each `ReviewState` carries a `revision`. A response includes `expectedRevision`;
a mismatch returns `409 REVISION_CONFLICT` and the client refreshes instead of
advancing the schedule twice. A repeated `clientEventId` returns the original
stored result rather than rescheduling (`apps/api/src/lib/idempotency.ts:37-52`).

Reviewer note: the revision check in `apps/api/src/modules/reviews/routes.ts` is a
read followed by a separate `update` keyed only on `(userId, cardId)`, inside a
transaction at PostgreSQL's default READ COMMITTED isolation. Two requests that
arrive at the same moment with the same `expectedRevision` and different
`clientEventId`s can both pass the check; the second `update` waits for the
first's row lock and then applies on top. The A05 integration test
(`apps/api/tests/learning/reviews.test.ts:157-183`) sends its two requests one
after the other, so it proves stale-revision rejection, not this race. The notes
module shows the race-free pattern: a conditional
`updateMany({ where: { ..., revision: expectedRevision } })` and a check that
`count === 0` means conflict (`apps/api/src/modules/notes/routes.ts:140-150`).

## Placement assessments

Five separately authored items per chapter, covering all chapter objectives. No
hints or solutions appear until submission.

**Qualification** = at least 4 of 5 correct **and** every item flagged
`critical` passing (`gradePlacement`, `placement.ts:32-47`; thresholds in
`DEFAULT_PLACEMENT_RULES`, line 20).

Qualifying grants the chapter `placed_out` and records placement evidence,
separately from lesson completion. It does **not** claim the owner completed
every exercise or retained the material, and (see above) it does not currently
change any concept's status.

Any earlier attempt on the same assessment version makes the next one
`practiceOnly` (`isPracticeOnly`, `placement.ts:55-57`), because submitting
revealed the answers. A practice attempt grants no fresh placement evidence and
never revokes an existing `placed_out`. Fresh evidence needs a newly authored
alternate version.

Manual skipping stays available regardless of score, and creates no mastery.

## Experience points

XP measures activity, never mastery. It is deliberately separate from evidence,
and assistance is always visible alongside it.

| Award | Amount | Key (`learning-core/src/xp.ts:20-33`) |
| --- | --- | --- |
| First accepted pass per exercise mastery revision | 10 | `exercise:<id>:r<masteryRevision>` |
| First lesson completion | 20 | `lesson:<id>` |
| First mission completion | 50 | `mission:<id>` |

Amounts and `levelForXp` live in `packages/contracts/src/domain.ts:15-24`:
`level = floor(totalXP / 250) + 1`.

The first-pass award is granted **whether or not** the attempt was assisted —
finishing counts, and the assistance is recorded separately rather than being
punished twice.

Nothing is awarded for opening pages, retrying, importing content, repeated
review clicks, manual skips, or placement alone (`NON_AWARDING_ACTIONS`,
`learning-core/src/xp.ts:64-71`).

Every award has a unique `(userId, awardKey)` constraint. Lessons and attempts
insert through `grantXp` (`apps/api/src/modules/curriculum/shared.ts:51-61`),
which uses `createMany({ skipDuplicates: true })` — an `INSERT … ON CONFLICT DO
NOTHING` — so a concurrent duplicate is a silent no-op. Missions use a second
helper, `awardXp` (`apps/api/src/lib/xp.ts:34-56`), which reads first and then
catches a failed `create`. Inside an interactive PostgreSQL transaction a failed
statement aborts the whole transaction, so that `catch` cannot actually recover:
after a lost race the mission save itself cannot commit, rather than continuing
with `awarded: false` as the comment says. No double award is possible either way.
How the losing request surfaces the aborted commit has not been tested; aligning
missions on `grantXp` would remove the question.

Lessons are never gated behind XP. Streaks are deliberately deferred: they add
timezone complexity and reward turning up rather than understanding.

## Exercises

These run the learning-core unit tests (no database). Install once with
`pnpm install` (read `handoff/03-environment.md` first on a shared machine).

**1. Read the ladder (easy).**
Goal: predict the due date after answering `good` three times in a row on a new
card first answered on 1 Jan, each answer given the moment the card is due.
**Check:** 2 Jan (step 1), 5 Jan (step 2, +3 days), 12 Jan (step 3, +7 days).
Confirm against the test "Good advances one step through the whole ladder" in
`packages/learning-core/tests/review-scheduler.test.ts`, then run
`pnpm --filter @devpractice/learning-core exec vitest run tests/review-scheduler.test.ts`.

**2. Recall alone is not enough (easy).**
Goal: explain why two clean `choice` passes on different items leave a concept
`practicing`.
**Check:** you cite `evidence.ts:162-164` (`applicationOrDebugPasses >= 1`) and the
test "requires at least one application or debugging pass, not two recall passes"
in `tests/evidence.test.ts`.

**3. Find the unused constant (medium).**
Goal: prove that changing the last element of `REVIEW_INTERVAL_DAYS` to `60`
changes no schedule.
**Check:** with that edit, `intervalDaysForStep(5)` still returns `30` because it
reads index 4, so "walks the published 1/3/7/14/30 ladder" still passes. Exactly
one assertion fails: `expect(Math.max(...REVIEW_INTERVAL_DAYS)).toBe(30)` in
"stays consistent with the shared REVIEW_INTERVAL_DAYS constant". Explain what
that assertion is guarding, then revert the edit.

**4. Write the placement-evidence test (hard).**
Goal: decide how a qualified placement attempt should feed `classifyConcept`
(spec §3.4), then write a failing test in `tests/evidence.test.ts` that encodes
it, before touching `apps/api/src/modules/progress/routes.ts`.
**Check:** the new test fails on the current code for the reason you expect, and
every existing test in the file still passes.
