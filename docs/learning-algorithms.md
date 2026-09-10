# Learning algorithms

Every rule in this document lives in `packages/learning-core` as a pure
function with an injected clock, so it can be unit-tested without a database
and without waiting for real time to pass.

These are **product heuristics chosen for legibility**, not validated
measurements of learning. See [known-limitations.md](known-limitations.md).

## Vocabulary that must not be conflated

Four different things are recorded separately, because they mean different
things:

| Record | Question it answers |
| --- | --- |
| Lesson status | Did the owner work through this lesson? |
| Exercise evidence | What happened on this attempt, with how much help? |
| Concept status | Has this idea been demonstrated, and is it still retained? |
| Placement | Did the owner skip this chapter by proving the objectives? |

Opening a chapter, skipping a lesson, and passing a placement assessment are
three different events. None of them is mastery.

## Lesson status

`not_started → in_progress → completed | skipped`

**Completion requires** a reading acknowledgement *and* a passing result on
every exercise marked `requiredForLessonCompletion`. Rubric exercises require a
self-assessment, because nothing objective can be checked.

Completion is **monotonic**: ordinary synchronisation never moves `completed`
back to `not_started`, and skipping an already-completed lesson leaves it
completed. Only an explicit future reset operation may undo it.

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

Resetting the starter does not reset what you now know. New independent
evidence comes from a different authored variant, or from a placement item.

Old assisted attempts are never erased when a later attempt succeeds. The
history shows what actually happened.

## Concept status

```
unseen → practicing → demonstrated → retained
                           ↑            │
                           └── review_due ←┘ (overdue)
```

**demonstrated** requires *all* of:

1. two passing objective activities,
2. on **distinct item ids**,
3. with `assistance = none` on both,
4. at least one of which is application or debugging rather than recall.

Browser-checked results count, carrying their `browser_automated` label.
Self-assessed rubric answers alone never satisfy this.

**retained** requires demonstrated, plus two successful due reviews on separate
UTC dates, the second at least **seven days** after the first.

An overdue review moves `retained → review_due`. It deletes no history; the
successful review dates remain recorded.

### Worked example

`js.array-filter`, all times UTC:

| Date | Event | Status after |
| --- | --- | --- |
| 01 Sep | Reads the lesson | `unseen` |
| 01 Sep | Passes `js-arrays-filter-open` after revealing the solution | `practicing` |
| 02 Sep | Passes it again independently after resetting the editor | `practicing` — the solution was revealed for this mastery revision |
| 03 Sep | Passes a *different* debugging exercise, no hints | `practicing` — one clean pass |
| 04 Sep | Passes a placement item on the same concept, no hints | `demonstrated` — two distinct items, one of them debugging |
| 05 Sep | Review answered correctly | `demonstrated` — one successful review |
| 13 Sep | Review answered correctly (8 days later) | `retained` |
| 20 Oct | Review became due and was not answered | `review_due` |

## Review scheduling

Six steps, a fixed interval table, measured from **server acceptance time**:

| Step | 0 | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- | --- |
| Interval (days) | 1 | 3 | 7 | 14 | 30 | 30 |

| Rating | Effect |
| --- | --- |
| `again` | step → 0, due in **10 minutes** |
| `hard` | step unchanged, due in **1 day** |
| `good` | step + 1 (max 5) |
| `easy` | step + 2 (max 5) |

Rules that matter:

- A newly introduced card starts at step 0 and is **immediately due**.
- An incorrect objectively-graded card **forces `again`**, whatever rating the
  client sent.
- A free-recall card is self-rated after revealing the answer. Those ratings
  schedule practice but are recorded as `self_reported` and do not count toward
  objective retention.
- Cards are introduced on first lesson completion, or by an explicit
  "Add to review" action. **Importing content enrols nothing.**

### Queue order

Overdue cards first, then newly introduced ones. The visible batch is 20 with an
explicit continue action. There is **no daily cap** hiding remaining work.

### Concurrency

Each `ReviewState` carries a `revision`. A response includes
`expectedRevision`; a mismatch returns `409 REVISION_CONFLICT` and the client
refreshes instead of advancing the schedule twice. A repeated `clientEventId`
returns the original result rather than rescheduling.

## Placement assessments

Five separately authored items per chapter, covering all chapter objectives. No
hints or solutions appear until submission.

**Qualification** = at least 4 of 5 correct **and** every item flagged
`critical` passing.

Qualifying grants the chapter `placed_out` and records placement evidence,
separately from lesson completion. It does **not** claim the owner completed
every exercise or retained the material.

Once answers have been revealed, repeat attempts on that same assessment
version are recorded as `practiceOnly` and grant no fresh placement evidence.
Fresh evidence needs a newly authored alternate version.

Manual skipping stays available regardless of score, and creates no mastery.

## Experience points

XP measures activity, never mastery. It is deliberately separate from evidence,
and assistance is always visible alongside it.

| Award | Amount | Key |
| --- | --- | --- |
| First accepted pass per exercise mastery revision | 10 | `exercise:<id>:<masteryRevision>` |
| First lesson completion | 20 | `lesson:<id>` |
| First mission completion | 50 | `mission:<id>` |

The first-pass award is granted **whether or not** the attempt was assisted —
finishing counts, and the assistance is recorded separately rather than being
punished twice.

Nothing is awarded for opening pages, retrying, importing content, repeated
review clicks, manual skips, or placement alone.

Every award has a unique `(userId, awardKey)` constraint, so a retried request
cannot double-count. `level = floor(totalXP / 250) + 1`. Lessons are never
gated behind XP.

Streaks are deliberately deferred: they add timezone complexity and reward
turning up rather than understanding.
