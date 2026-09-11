# M06 — Inventory, and the invariants that hold it together

**Work type:** build from a scaffold
**Stack:** Node.js + Fastify + Prisma + PostgreSQL
**Prerequisites:** chapter 14, and M02
**Platform mission id:** `m06-inventory-core`

A new service, built from an empty routes file. The database, the schema, the
migrations, the seed and the server already work. Every endpoint is missing.

| Endpoint | Behaviour |
| --- | --- |
| `POST /products` | create a product |
| `GET /products` | list products with on-hand quantity |
| `POST /products/:id/movements` | record stock in or out |
| `POST /orders` | create an order with lines, and place it |
| `GET /orders/:id` | fetch an order with its lines and total |

## The invariants are the mission

The CRUD is not the interesting part. These are:

1. A SKU is unique across products.
2. A movement's delta is a non-zero whole number.
3. On-hand stock is never negative.
4. An order has at least one line, and every line has quantity at least 1.
5. A line references a product that exists.
6. Placing an order records the stock movements for its lines, and either all of
   that happens or none of it does.

Part of the work is deciding, for each one, whether it belongs in the **schema**,
in a **transaction**, or in the **route** — and being able to say why there.

Read `prisma/schema.prisma` before writing a route. On-hand stock is the **sum of
movements**, not a column you decrement. That makes "never negative" harder to
state, because there is no single value to hang a `CHECK` on, and it is what
gives every change a reason and an audit trail, and what stops two concurrent
writers losing an update by overwriting a total.

## Setup

PostgreSQL on `127.0.0.1:5440`. This mission owns `m06_inventory` and
`m06_inventory_test`, and can reach neither the platform database nor another
mission's.

```bash
cd projects/m06-inventory-core/starter
cp .env.example .env
npm install
npm run db:deploy
npm run db:seed
npm run dev                      # http://localhost:3106
```

## The two check commands

```bash
npm run check:baseline   # MUST pass now: database, migrations, constraints, health
npm run check:mission    # MUST fail now: every endpoint answers 501
```

The starter answers `501 NOT_IMPLEMENTED` deliberately, so a fresh checkout fails
loudly rather than half-working.

## Status codes the checks expect

| Situation | Response |
| --- | --- |
| created | 201 with `{ "data": ... }` |
| invalid body | 400 with `{ "error": { "code": "BAD_REQUEST", "fieldErrors": ... } }` |
| duplicate SKU | 409 |
| line references a product that does not exist | 404 |
| not enough stock | 409, naming the product and the quantities |
| unknown order id | 404 |

Money is in minor units throughout — whole pence, never a float. An order total
is derived from the prices captured on its lines, so repricing a product later
must not change a placed order.

## Acceptance criteria

- [ ] A duplicate SKU is rejected with 409, decided by the unique index rather
      than by a read before the insert.
- [ ] A rejected product writes no rows.
- [ ] `GET /products` reports on-hand summed from the ledger, including zero for
      a product that has never moved.
- [ ] A zero or fractional delta is 400; an unknown product is 404.
- [ ] A movement that would drive stock negative is 409 and writes nothing.
- [ ] An order with no lines, or a line below quantity 1, is 400.
- [ ] A line referencing a missing product is 404 and writes no order.
- [ ] A shortfall on the second line leaves **no trace** of the first.
- [ ] An order total survives a reprice of its products.
- [ ] `GET /orders/:id` returns lines and a total, and 404 for an unknown id.

## Hints

1. Start with the schema, not the routes. Read every constraint and write down
   what each makes impossible. Several acceptance criteria are already enforced
   there, and your route only has to turn the resulting error into a decent
   response.
2. For the duplicate SKU, let the insert fail and catch it — Prisma raises
   `P2002`. A read that checks first has a gap between the two statements, and
   two concurrent requests both pass the check. A unique index has no gap.
3. Placing an order needs one `$transaction`, and the stock check must happen
   **inside** it and be re-read there. Checking before you open the transaction
   tells you what was true a moment ago. Throwing from inside the callback is
   what rolls everything back.

## What to write up

- Where you enforced each invariant, and the alternative you rejected.
- Why a read-then-insert uniqueness check is not equivalent to a unique index.
- What the stock ledger buys and what it costs.
- What a half-placed order would look like in the database, and what prevents it.

## Reference solution

`solution/src/routes/inventory.ts` replaces `starter/src/routes/inventory.ts`.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `P1001 Can't reach database server` | PostgreSQL is not listening on 5440 | start it, or repoint `DATABASE_URL` |
| Every mission check 501s | the routes are still the stubs | that is the starting state |
| A shortfall surfaces as 500 | the constraint error is escaping the route | catch it and translate it |
| Stock goes negative under two concurrent orders | the check is outside the transaction | move the read inside it |
