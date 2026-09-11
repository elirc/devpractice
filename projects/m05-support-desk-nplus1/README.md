# M05 — A dashboard that asks too many questions

**Work type:** investigate and repair a performance defect
**Stack:** Node.js + Fastify + Prisma + PostgreSQL
**Prerequisites:** chapter 13, and M02
**Platform mission id:** `m05-support-desk-nplus1`

This code works. Every baseline check passes and every response is correct. You
are not fixing a wrong answer here, you are fixing how a right answer is
obtained.

The desk added a dashboard listing tickets with their comment counts and latest
comment. It was fine against five seeded tickets. With a realistic backlog the
page takes seconds and the database sits at high CPU, and nobody can point at a
slow line, because no single line is slow.

## The shape of the problem

One query fetches the page of tickets. Then, for each ticket, two more go out:
one to count its comments, one to find the newest. Twenty tickets is forty-one
round trips. The source reads perfectly well. The cost is invisible in the code
and obvious in a log of what was actually sent.

So this mission hands you the log.

## Setup

PostgreSQL must be reachable on `127.0.0.1:5440`. This mission owns
`m05_nplus1` and `m05_nplus1_test`, separate from the platform database and from
every other mission's.

```bash
cd projects/m05-support-desk-nplus1/starter
cp .env.example .env
npm install
npm run db:deploy                # migrations onto an empty database
npm run db:seed                  # repeatable
npm run dev                      # http://localhost:3105
```

## Measure before you change anything

```bash
npm run check:baseline   # MUST pass now: the dashboard is CORRECT
npm run check:mission    # MUST fail now: the dashboard is EXPENSIVE
```

Read the mission failure output before writing code. It prints the SQL that was
actually issued. Counting those statements yourself is the skill this mission is
really teaching, because a fix you cannot measure is a guess.

## Two things you must not change

**The measurement.** `src/db.ts` holds the query recorder. It is instrumentation,
not assignment. The single listener it registers is deliberate: Prisma has no way
to remove an event listener, so one per measurement would leak them and
cross-contaminate counts.

**The answer.** The response body is pinned. The mission checks compare your
output against the same dashboard computed independently from the database,
including the cases that catch a plausible wrong fix.

## Acceptance criteria

- [ ] The query count for `GET /tickets?withComments=true` does not grow with the
      page size: 20 tickets costs the same as 4.
- [ ] A full page of 20 costs at most 3 queries.
- [ ] Same rows, same order, same `commentCount`, same `latestCommentBody`.
- [ ] A ticket with no comments reports zero and a null latest comment, and is
      **not dropped** from the page.
- [ ] The latest comment is the newest by `createdAt`, with `id` as the
      tiebreaker, not whichever row came back first.
- [ ] The plain listing stays cheap and gains no comment fields it was not asked
      for.
- [ ] `src/db.ts` is unchanged.

## Hints

1. Do not optimise yet. Run the mission checks, read the SQL, and write down the
   count for a page of 4 and a page of 20. The rest of the mission is making the
   second number stop depending on the first.
2. Two round trips can answer the whole page: fetch the tickets, then fetch the
   comment data for all of their ids at once. `groupBy` with `_count` gives you
   the counts. The latest comment per ticket is the harder half.
3. For "the latest per group", either sort the relevant comments once in SQL and
   keep the first per ticket in memory, or write a window function with
   `$queryRaw`. Both are fine. A query inside a loop is not, however tidy the
   loop looks.

## What to write up

- The query count before and after, for two page sizes, from measurement.
- Why the starter was correct and still unacceptable.
- Why a ticket with no comments is the case that catches a wrong fix.
- What you would measure next if the page were still slow.

## Reference solution

`solution/src/routes/tickets.ts` replaces `starter/src/routes/tickets.ts`.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `P1001 Can't reach database server` | PostgreSQL is not listening on 5440 | start it, or repoint `DATABASE_URL` |
| Query count is 0 in every measurement | the recorder in `src/db.ts` was changed | restore it from the starter |
| Counts are right but the page is short | an inner join dropped the ticket with no comments | the aggregate has no row for it at all; default to zero |
| Mission checks pass on a fresh checkout | you are running a modified `tickets.ts` | restore it from the starter |
