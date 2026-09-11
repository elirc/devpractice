# M08 — A report job you can rerun

**Work type:** extend existing code
**Stack:** Node.js + Fastify + Prisma + PostgreSQL
**Prerequisites:** chapters 16 and 18, and M07
**Platform mission id:** `m08-inventory-report-job`

A nightly stock-valuation report. For every product it writes one row holding the
quantity on hand and its value, then marks the job succeeded. On a first run, on
a quiet machine, it works, and `check:baseline` proves exactly that much.

It cannot be rerun. A background job that cannot be rerun is a job you cannot
operate, because every retry, every deployment part-way through a run, and every
duplicated scheduler tick is a second run.

## The four defects

1. **A rerun repeats committed work.** The unique index on `(jobId, productId)`
   stops the duplicate row being stored — so instead of quietly duplicating, the
   rerun dies on the first product it already did and the job can never finish. A
   loud failure is still a failure. Resuming means doing the **remaining** work.
2. **A succeeded job runs all over again.**
3. **`maxAttempts` and `runAfter` are unused.** Nothing stops a hopeless job
   retrying forever, and nothing delays the next try.
4. **The claim is a read followed by a write**, so two workers can both decide the
   job is theirs.

## At-least-once invocation, exactly-once effect

Carry this while you work, because the reflection asks for it. This runner is
invoked **at least once** and may be invoked again at any moment. You cannot make
the invocation happen exactly once. You can make its committed **effect** exactly
once. Say which you mean, every time.

## Setup

PostgreSQL on `127.0.0.1:5440`, with `m08_inventory` and `m08_inventory_test`
belonging to this mission alone.

```bash
cd projects/m08-inventory-report-job/starter
cp .env.example .env
npm install
npm run db:deploy
npm run db:seed
npm run dev                      # http://localhost:3108
npm run job:run                  # one pass of the worker, by hand
```

## Where the work is

`src/jobs/report.ts` is the only file you need to change. The inventory endpoints
are carried forward from M06 and M07 and are already correct. `src/routes/reports.ts`
enqueues a job and reads one back, and is also done — it returns **202** and runs
nothing inside the request, because a report over the whole catalogue has no
business holding an HTTP connection open, and a caller who disconnects must not
cancel work that was accepted.

## The two check commands

```bash
npm run check:baseline   # MUST pass now: one clean run writes the right report
npm run check:mission    # MUST fail now: the second run
```

Note where the line falls. The baseline pins a single clean run, the numbers in
the report, and the unique index that makes a duplicate detectable at all. The
mission checks are about the second invocation.

## The failure seam

`runReportJob` takes an optional `beforeItem` hook, called before each product is
written. The checks use it to kill a run part-way through; production code passes
nothing. It exists because injecting a failure is the only way to test a resume,
and a seam visible in the signature beats a mock that reaches inside.

Keep the return shape. The checks read `status`, `linesWritten`, `attempts` and
`detail`, and the difference between "I did the work" and "I did nothing" has to
be visible to the caller.

## Acceptance criteria

- [ ] A rerun after a partial failure completes the job.
- [ ] A rerun writes only the lines that were missing.
- [ ] After a failure and a rerun there is exactly one line per product, with the
      numbers a clean run would have produced.
- [ ] Both attempts are counted.
- [ ] A succeeded job is skipped, writes nothing, and does not count an attempt.
- [ ] A failed attempt moves `runAfter` forward, and a second failure waits longer
      than the first.
- [ ] Once attempts reach `maxAttempts` the job is no longer picked up, and a
      refused invocation is not counted as an attempt.
- [ ] An exhausted job keeps whatever it committed, for an operator to inspect.
- [ ] Two concurrent invocations result in exactly one doing the work and one
      reporting it was skipped, with one line per product and one attempt.
- [ ] A failure is reported as a failure, with a message an operator can act on.

## Hints

1. Make the claim one statement. `updateMany` with the old status in its `WHERE`
   clause is a conditional update: PostgreSQL locks the row, re-evaluates the
   condition and tells you how many rows changed. One concurrent worker sees 1 and
   the other sees 0, and no separate read could have told them apart.
2. A resume needs one extra query before the loop: which products has this job
   already written? Skip those. Note what this is **not** — it is not what
   prevents duplicates, the unique index is. It is what lets the job make
   progress.
3. Decide what state a failed attempt leaves behind, and use the columns already
   in the schema. `runAfter` is when a scheduler should next consider the job;
   `attempts` against `maxAttempts` is whether it should be considered at all.
   Leaving a job on `running` after a failure is the one choice that makes it
   unrecoverable.

## What to write up

- Why a conditional update is a different kind of thing from a read then a write.
- The difference between the query that makes a resume possible and the constraint
  that makes duplication impossible.
- The state you leave a failed job in, and what goes wrong in the alternative.
- The delivery guarantee, in terms of effects rather than invocations.
- The failure mode your solution does **not** handle.

## Reference solution

`solution/src/jobs/report.ts` replaces `starter/src/jobs/report.ts`.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `P1001 Can't reach database server` | PostgreSQL is not listening on 5440 | start it, or repoint `DATABASE_URL` |
| `P2002` on a rerun | the rerun is repeating committed work | read which products are already done and skip them |
| A direct retry is skipped immediately after a failure | the claim is gating on `runAfter` | `runAfter` is for the scheduler, not for an operator retrying now |
| Concurrent runs both succeed | the claim is still a read then a write | make it one conditional `updateMany` and check the count |
