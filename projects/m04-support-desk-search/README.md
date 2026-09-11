# M04 — Search, and the pagination it breaks

**Work type:** extend existing code
**Stack:** Node.js + Fastify + Prisma + PostgreSQL
**Prerequisites:** chapters 13 and 15, and M02
**Platform mission id:** `m04-support-desk-search`

Everything M02 built is here and working: create, list with cursor pagination,
detail, and comments. `npm run check:baseline` proves it.

What is missing is search. Dispatchers cannot find a ticket by typing part of a
title or a customer name, and the backlog is now long enough that scrolling is
not an answer.

Adding a `WHERE` clause is ten minutes of work. Keeping pagination correct while
that clause is applied is the mission.

## Identity here is training scaffolding, NOT authentication

Requests name themselves with an `x-training-user` header. There is no
credential and nothing is verified. This starter does not implement
authentication and does not claim to.

## Setup

PostgreSQL must be reachable. The starter defaults to `127.0.0.1:5440` with the
`postgres` role and uses two databases of its own, `m04_search` and
`m04_search_test` — separate from the DevPractice platform database and from
every other mission's. Nothing you do here can touch your learning records.

```bash
cd projects/m04-support-desk-search/starter
cp .env.example .env             # adjust only if your server is elsewhere
npm install
npm run db:deploy                # applies migrations to an empty database
npm run db:seed                  # repeatable: safe to run twice
npm run dev                      # http://localhost:3104
```

The test database is separate from the development one and is truncated between
cases, so seeding it is neither needed nor wanted.

## The two check commands

```bash
npm run check:baseline   # MUST pass before you start: DB, migrations, M02 endpoints
npm run check:mission    # MUST fail before you start, pass when you are done
```

They are separate commands on purpose. A failing `check:mission` on a fresh
checkout is the assignment. A failing `check:baseline` is a broken environment,
and no amount of writing code will fix it.

## What you are implementing

One query parameter, `q`, on `GET /tickets`.

| Requirement | Why it is here |
| --- | --- |
| Match `title`, `body` and `customerName` | dispatchers search for whatever they remember |
| Case-insensitive | "PRINTER" and "printer" are the same search |
| Composes with `status` | a filter and a search are independent ideas |
| Empty `q` behaves as no search | an empty search box is not a search for nothing |
| Pagination stays correct | see below |

## Why pagination is the hard part

Look at `tests/helpers.ts`. The fixture is built to punish the obvious
implementations:

- Six tickets match, and they are **not contiguous** in the full ordering, so
  filtering after paging returns short or empty pages.
- All six share **one `createdAt` value**. Ordering by a timestamp alone is not
  a total order, so a cursor carrying only the timestamp cannot say where it got
  to: rows repeat or vanish.
- The word appears in three different columns, in three different casings.
- Two tickets contain "print" but not "printer", so a too-loose match picks up
  rows the user did not ask for.

And one question the checks leave open on purpose: a cursor issued for one search
is handed back with different search text. Reject it, or make the cursor carry
enough to stay correct. Either is defensible. Silently returning the wrong page
is not.

## Acceptance criteria

- [ ] `GET /tickets?q=printer` returns exactly the matching tickets.
- [ ] Matching covers `title`, `body` and `customerName`.
- [ ] Matching is case-insensitive.
- [ ] A substring the user did not ask for does not match.
- [ ] `q` composes with `status`.
- [ ] An empty `q` behaves like no search at all.
- [ ] No matches returns an empty page with `hasMore: false`, not an error.
- [ ] Paging through a search returns every match exactly once, at any page size.
- [ ] The search stays applied on the second page, not only the first.
- [ ] A cursor reused with different search text does not silently mis-page.
- [ ] Migrations apply cleanly to an empty database.
- [ ] `npm run db:seed` twice produces the same data, not duplicates.

## Hints

1. Prisma's `contains` takes a `mode` option. Start there, then ask what a page
   of results is actually ordered by.
2. A cursor has to identify a row uniquely. `createdAt` does not, in this
   fixture. What pair of columns does?
3. Think about what the cursor is a position WITHIN. If the answer is "this
   specific query", then either the filter belongs in the cursor, or a cursor
   from another query has to be refused.

## What to write up

- Why ordering by `createdAt` alone is not enough, with the fixture as evidence.
- What you decided about a cursor reused across a different search, and the
  alternative you rejected.
- What you would need to add before this search was acceptable on a large table,
  and how you would know it was needed.

## Reference solution

`solution/src/routes/tickets.ts` replaces `starter/src/routes/tickets.ts`. Read
it after your own attempt.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `P1001 Can't reach database server` | PostgreSQL is not listening on 5440 | start it, or repoint `DATABASE_URL` |
| `relation "Ticket" does not exist` | migrations not applied | `npm run db:deploy` |
| Mission checks pass on a fresh checkout | you are running a modified `tickets.ts` | restore it from the starter |
| Baseline fails on the cursor test | `TEST_DATABASE_URL` points at the dev database | check `.env` |
