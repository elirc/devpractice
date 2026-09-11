# M11 reference solution

Copy `src/Inventory.Api/OrderService.cs` over the starter file of the same path
and run both check commands.

Two changes, one idea: **a decision made on stale data must not be allowed to
win.**

1. **One transaction for the whole order.** Every write happens inside
   `BeginTransactionAsync`, and the commit is the last statement. A failed line
   rolls the whole thing back, so there is no half-applied order to clean up.
2. **The stale write is detected, not overwritten.** `QuantityOnHand` is
   decremented on a tracked entity whose `xmin` concurrency token was read at
   the start. If another transaction changed the row in between, EF Core raises
   `DbUpdateConcurrencyException` instead of writing a number computed from a
   value that is no longer true. The retry loop re-reads and re-decides.

The check constraint in the schema is the backstop, not the mechanism: it
guarantees no negative stock can ever be persisted, even by a code path nobody
has written yet.
