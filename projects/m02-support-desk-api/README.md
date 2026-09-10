# M02 — Persistent ticket API

**Work type:** extend a scaffold
**Stack:** Node.js + Fastify + Prisma + PostgreSQL
**Prerequisites:** chapters 9 and 10, plus M01 or equivalent experience
**Platform mission id:** `m02-support-desk-api`

M01 built the interface against a mock adapter. Now you build the backend it
talks to, then point M01's adapter at it.

## Identity in this starter is training scaffolding, NOT authentication

Requests carry an `x-training-user` header naming one of the seeded fictional
users. There is no password, no session and no token. **This starter does not
implement authentication and does not claim to.** Real ownership enforcement is
mission M03, and real authentication is the platform's own concern.

## Setup

```bash
cd projects/m02-support-desk-api/starter
cp .env.example .env
docker compose up -d db          # PostgreSQL on port 5441
npm install
npm run db:migrate               # applies migrations to an empty database
npm run db:seed                  # repeatable: safe to run twice
npm run dev                      # http://localhost:3101
```

The learning database is **separate** from the DevPractice platform database.
Nothing you do here can touch your learning records.

## The two check commands

```bash
npm run check:baseline   # MUST pass before you write code: DB reachable, migrations applied, seed loaded
npm run check:mission    # MUST fail before you start, pass when you are done
```

## What you are implementing

| Endpoint | Behaviour |
| --- | --- |
| `POST /tickets` | validates title and body, returns 201 with the created record |
| `GET /tickets` | cursor pagination, deterministic order, bounded page size |
| `GET /tickets/:id` | 404 for an unknown id |
| `GET /tickets/:id/comments` | comments for one ticket |
| `POST /tickets/:id/comments` | rejects a comment on a ticket that does not exist |

## Acceptance criteria

- [ ] `POST /tickets` rejects an empty or whitespace-only title with 400 and a field error.
- [ ] Invalid input changes **no rows**.
- [ ] `GET /tickets` orders by `createdAt` then `id` so the order is total and stable.
- [ ] Page size is bounded; a caller cannot request 10,000 rows.
- [ ] Paging through the whole list yields every ticket exactly once, no duplicates.
- [ ] An unknown ticket id returns 404, not 500 and not an empty 200.
- [ ] A comment referencing a missing ticket is rejected rather than orphaned.
- [ ] Migrations apply cleanly to an empty database.
- [ ] `npm run db:seed` twice produces the same data, not duplicates.
- [ ] Integration tests cover the empty list, multiple pages, and the missing record.

## Hints

1. Decide what the route layer is responsible for and what the data layer is
   responsible for before writing either. Parsing and status codes are transport
   concerns; "a comment needs a ticket" is a data rule.
2. A cursor has to encode enough to resume a **total** order. Ordering by
   `createdAt` alone is not total when two rows share a timestamp.
3. TypeScript checks the shape of values you already have. It cannot check a
   JSON body that arrived over the network — that needs a runtime schema.

## Connecting M01

Replace the mock in M01's `src/main.tsx` with an adapter implementing the same
`TicketApi` interface over `fetch`. If you have to change any component to do
it, the adapter boundary was leaking.

## Reflection

Which rules belong in API validation and which belong in database constraints?
Name one rule that belongs in both, and explain why the duplication is worth it.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `P1001 Can't reach database server` | container not up | `docker compose up -d db` and wait for healthy |
| `P3005 database schema is not empty` | migrating over existing data | `npm run db:reset` (destroys the LEARNING database only) |
| Port 5441 already allocated | another Postgres is bound | change the host port in `docker-compose.yml` and `.env` |
| Tests hang | tests ran against the dev database | confirm `TEST_DATABASE_URL` is set and different |
