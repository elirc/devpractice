# M11 — Two orders, one last box of lids

**Work type:** extend existing code
**Stack:** C# / ASP.NET Core + EF Core + PostgreSQL
**Prerequisites:** .NET chapters 6 and 7, and M09
**Platform mission id:** `m11-dotnet-inventory-concurrency`

Sixteen boxes of lids are in stock. Two orders for twelve arrive at the same
moment. Both read sixteen, both conclude twelve is fine, and both write four.
One of them is wrong, and the database will happily store the wrong answer
because nothing told it the decision was based on a number that had already
changed.

Two failures in one file, and they share an idea: **a decision made on stale
data must not be allowed to win.**

1. **Saving happens inside the loop**, so a failure on a later line leaves earlier
   lines and their stock movements committed. There is no order you could show an
   operator and no single state to roll back to.
2. **The decrement is a write of a computed number**, not a conditional one. The
   concurrency token is already in the schema and mapped, and the order path
   ignores it.

## Setup

PostgreSQL must be reachable. This mission uses `m11_inventory` and
`m11_inventory_test`, separate from the platform database and from every other
mission's.

```bash
cd projects/m11-dotnet-inventory-concurrency/starter
dotnet restore
dotnet build
```

The SDK is pinned in `global.json` to .NET 10. `.env.example` documents
`INVENTORY_CONNECTION` and `INVENTORY_TEST_CONNECTION`; nothing loads a `.env`
file for you, and the code defaults already point at those two databases. The
schema is created with `EnsureCreatedAsync` rather than a migration.

## The two check commands

```bash
dotnet test --filter Category=Baseline   # MUST pass before you start
dotnet test --filter Category=Mission    # MUST fail before you start
```

Read the baseline list before you start, because one of its tests matters: it
proves that a conflicting edit **on a product** already raises
`DbUpdateConcurrencyException`. The token works. Making the **order path** handle
it is your job, and knowing the mechanism is already in place tells you the
mission is not "add a token", it is "stop ignoring one".

## Acceptance criteria

- [ ] A failed line leaves **no** partial order: no order row, no order lines, no
      stock movements, and no decremented stock.
- [ ] Two concurrent orders for the last twelve lids result in exactly one success
      and one failure.
- [ ] After those two concurrent orders, stock on hand is four and exactly one
      order exists.
- [ ] A successful order still records one line and one stock movement per
      product, and decrements each correctly.

## The constraint is the backstop, not the mechanism

There is a check constraint forbidding negative stock. It is not what makes this
correct; it is what guarantees no negative stock can ever be persisted, including
by a code path nobody has written yet. Application logic for the normal case and a
constraint for the case you did not think of is a pairing worth recognising — M07
used exactly it for duplicate order submission in Node, and the two halves fail at
different moments, one before the write and one at it.

## Hints

1. Look at where `SaveChangesAsync` is called. Saving inside the loop is what lets
   a later failure leave earlier lines committed.
2. `db.Database.BeginTransactionAsync` gives you an explicit transaction. Add
   every entity first, save once, then commit. If an exception escapes before the
   commit, the transaction rolls back and nothing survives.
3. For the oversell, the concurrency token does the detecting: because `Version`
   maps to `xmin`, a stale UPDATE raises `DbUpdateConcurrencyException` instead of
   writing. Catch it, discard the stale decision, re-read the product, and decide
   again. A retry loop of a few attempts is enough.

## What to write up

- Why retrying is the right response to a concurrency exception, and what it means
  that you must re-read before deciding again.
- What optimistic concurrency costs, and when a pessimistic lock would be the
  better trade.
- How you would demonstrate the oversell to someone who did not believe it
  happened.
- What the check constraint would catch that your code would not.

## Reference solution

`solution/src/Inventory.Api/OrderService.cs` replaces the starter file of the same
path. Nothing else changes.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `No project or solution file found` | you are not in `starter/` | `cd` there; `Inventory.sln` lives at its root |
| `Npgsql.NpgsqlException: Connection refused` | PostgreSQL is not listening on 5440 | start it, or set `INVENTORY_TEST_CONNECTION` |
| Both concurrent orders succeed | the decrement still writes a computed number | let the token detect the stale write |
| Both concurrent orders fail | the retry re-uses the stale entity | re-read the product inside the retry, not outside it |
| A failed line leaves movements behind | there is still a save inside the loop | one save, then one commit |
