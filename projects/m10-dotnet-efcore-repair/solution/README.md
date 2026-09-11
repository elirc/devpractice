# M10 reference solution

Copy `src/SupportDesk.Api/TicketEndpoints.cs` over the starter file of the same
path and run both check commands.

Three repairs, none of them cosmetic:

1. **Ownership moved into the query.** `FirstOrDefaultAsync(t => t.Id == id)`
   became `... && t.OwnerId == owner`. A row the caller may not see is never
   loaded, so there is nothing to leak and no later filter to forget. A UI
   restriction would not have fixed this.
2. **The N+1 became one projected query.** The per-row `CountAsync` is gone;
   the count is computed in the projection, so two tickets cost one SELECT.
3. **Projection replaced graph loading.** The detail endpoint no longer
   `Include`s comments it never returns, the comments endpoint queries the
   `Comments` table directly, and read paths use `AsNoTracking()`.
