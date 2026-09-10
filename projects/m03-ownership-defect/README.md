# M03 — Ownership defect and regression tests

**Work type:** repair existing code
**Stack:** Node.js + Fastify + Prisma + PostgreSQL
**Prerequisites:** chapters 11 and 12, and M02
**Platform mission id:** `m03-ownership-defect`

This is a working support desk API with two fictional dispatchers, **Dana** and
**Ravi**. It starts, it serves requests, and its baseline checks pass. It also
lets one dispatcher reach the other's data.

Your job is to find the boundary that is missing, fix it properly, and leave
regression tests that would have caught it.

## Documented access policy

> A resource the caller may not access is reported as **404 Not Found**.

Not 403. Confirming that a record exists is itself a disclosure: a 403 tells an
attacker the id is real. Inaccessible and non-existent must be indistinguishable
from outside. Your fix must apply this **consistently** — one endpoint already
gets this wrong in a different way.

## Setup

```bash
cd projects/m03-ownership-defect/starter
cp .env.example .env
docker compose up -d db          # PostgreSQL on port 5442
npm install
npm run db:migrate
npm run db:seed
```

## Reproduce the defect before you fix it

```bash
npm run dev

# Dana's ticket, requested by Ravi. This should not succeed.
curl -s http://localhost:3102/tickets/seed-t-1 -H 'x-training-user: user-ravi'
```

## The two check commands

```bash
npm run check:baseline   # MUST pass now: the app works
npm run check:mission    # MUST fail now: the security regressions
```

A failing `check:mission` here is the defect, not a broken environment.

## Acceptance criteria

- [ ] One dispatcher cannot **view** another's ticket.
- [ ] One dispatcher cannot **edit** another's ticket.
- [ ] One dispatcher cannot **read or write comments** on another's ticket.
- [ ] List queries stay owner-scoped, including with a crafted cursor.
- [ ] Every inaccessible resource returns **404**, matching the documented policy.
- [ ] No foreign data appears in any response body, including error messages.
- [ ] The owner's own operations all still work.
- [ ] Regression tests cover every affected endpoint.
- [ ] Logs keep a request id and contain no ticket bodies or customer names.

A fix that only hides the button in the interface does **not** pass. The API is
the boundary.

## Hints

1. Compare the endpoints against each other. One of them already scopes its
   query by owner. Why do the others not?
2. "Fetch, then check" and "fetch only what this user may see" behave the same
   for the owner and very differently for everyone else. Prefer the second: a
   query that cannot return a foreign row cannot leak one.
3. Look at what the refusal message says out loud. An error can leak the very
   thing the check was protecting.

## What to write up

- A short defect explanation in your own words: what was reachable, by whom.
- Where the access-control boundary belongs, and why there rather than higher up.
- Which regression test would have caught this before release, and why it did
  not exist.

## Reference solution

`solution/src/routes/tickets.ts` replaces `starter/src/routes/tickets.ts`. It
uses owner-scoped queries and a small shared helper rather than rewriting the
framework or adding a permissions library.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `P1001 Can't reach database server` | container not up | `docker compose up -d db` |
| Port 5442 already allocated | M02's database is on 5441; something else took 5442 | change the host port in `docker-compose.yml` and `.env` |
| Security tests pass on a fresh checkout | you are running against a modified `tickets.ts` | `git checkout -- src/routes/tickets.ts` |
