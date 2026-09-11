# M07 — The order that was placed twice

**Work type:** repair existing code
**Stack:** Node.js + Fastify + Prisma + PostgreSQL
**Prerequisites:** chapter 14, and M06
**Platform mission id:** `m07-inventory-idempotency`

The inventory service works. Orders are placed, stock moves, everything commits
atomically. It also has a defect that only appears in production, which is the
worst place to find one.

The ordering app retries. Phones drop connections, the load balancer gives up at
thirty seconds while the request is still committing, and people press "Place
order" again when nothing seems to have happened. The API documents an
`Idempotency-Key` header for exactly this, and the client sends it faithfully.

The header is accepted and ignored. A retried submission places a second order
and moves stock again. Warehouse staff are picking duplicates and the on-hand
figures have drifted.

## The four rules

1. **Same key, same body, twice** → one order; the second replays the first
   response, including its order id, with **200**.
2. **Same key, same body, concurrently** → still one order. This is the rule that
   rules out the tempting shape, because two requests genuinely in flight at the
   same instant both pass a "have I seen this key?" check before either writes.
3. **Same key, different body** → **409**. The client reused a key for a different
   intent. Quietly discarding the second order would be worse than refusing it.
4. **Keys are scoped per user.** Two people may both choose `order-1`.

A failed submission must not record a success. And look at what is already in
`prisma/schema.prisma` before designing anything: `IdempotencyRecord` has a
unique constraint on `(ownerId, operation, key)`.

## Setup

PostgreSQL on `127.0.0.1:5440`, with `m07_inventory` and `m07_inventory_test`
belonging to this mission alone.

```bash
cd projects/m07-inventory-idempotency/starter
cp .env.example .env
npm install
npm run db:deploy
npm run db:seed
npm run dev                      # http://localhost:3107
```

## Reproduce the defect before you fix it

```bash
curl -s -X POST http://localhost:3107/orders \
  -H 'content-type: application/json' \
  -H 'idempotency-key: demo-1' \
  -d '{"customerName":"Brightleaf Bakery","lines":[{"productId":"prod-ink-black","quantity":2}]}'
```

Run it twice, compare the two order ids, then check on-hand stock.

## The two check commands

```bash
npm run check:baseline   # MUST pass now: orders, stock and atomicity all work
npm run check:mission    # MUST fail now: the retry rules
```

A failing `check:mission` here is the defect, not a broken environment.

One of the mission checks fires two submissions at the same instant with
`Promise.all` and then counts the orders. A fix that works when the retry arrives
a second later and fails when it arrives in the same millisecond will be caught —
which is the point. The bug is a timing bug, so a fix that depends on timing has
not fixed it.

## Acceptance criteria

- [ ] Two sequential submissions with the same key and body create one order; the
      second returns 200 with the first response.
- [ ] Two **concurrent** submissions with the same key and body still create one
      order, and one stock movement per line.
- [ ] The same key with a different body is 409, not a replay.
- [ ] Keys are scoped per training user.
- [ ] A submission with no `Idempotency-Key` behaves exactly as today.
- [ ] An invalid body does not consume the key: correcting it and retrying with
      the same key succeeds.
- [ ] A submission that fails for a shortfall does not record a success.
- [ ] Stock moves exactly once per placed order, verified from the ledger rather
      than from the API response.
- [ ] Nothing about the other endpoints changes.

## Hints

1. Read the `IdempotencyRecord` model and its unique constraint first. Ask which
   of the four rules that constraint can decide on its own, and which one you
   have to decide yourself.
2. A check-then-write cannot work here and reordering the statements will not
   save it, because the gap is between two round trips. Invert it: attempt the
   insert and treat the unique violation (`P2002`) as the answer rather than as an
   error.
3. Decide where the receipt is written. Inside the same transaction as the order,
   a failure rolls the receipt back with the work and a crash between the two
   becomes impossible. Outside it, you have invented a new way to lose or
   duplicate an order. Then store a fingerprint of the body so you can tell a
   genuine retry from a reused key.

## What to write up

- Why a read-then-write idempotency check fails under concurrency.
- Which database object makes the guarantee, and what breaks without it.
- Why 409 rather than a replay for a reused key with a different body.
- What is exactly-once here and what is merely at-least-once, and which one the
  client sees.

## Reference solution

`solution/src/routes/inventory.ts` replaces `starter/src/routes/inventory.ts`.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `P1001 Can't reach database server` | PostgreSQL is not listening on 5440 | start it, or repoint `DATABASE_URL` |
| Sequential retries work, concurrent ones do not | the decision is still a read before a write | let the unique constraint arbitrate |
| A corrected retry replays the old failure | the receipt was written outside the transaction | move it inside |
| 201 on a replay | the replay path is creating, not replaying | a request that created nothing returns 200 |
