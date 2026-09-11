# M12 reference solution

Copy `src/Reports.Api/ReportRunner.cs` over the starter file of the same path
and run both check commands.

Three changes, and the comparison with M08 is the point of the mission:

1. **The token is observed.** `ct.ThrowIfCancellationRequested()` at the top of
   each item means a shutdown stops the run at an item boundary rather than
   part-way through one. Node's M08 does the same job with an `AbortSignal`
   checked in the loop — different type, identical discipline: cancellation is
   COOPERATIVE, and code that never checks cannot be cancelled politely.
2. **Committed effects are skipped, not repeated.** The runner reads the
   `ItemKey`s already written for this job and processes only the remainder, so
   a rerun after a partial failure finishes the work instead of duplicating it.
3. **A finished job is a no-op.** Re-running a `Succeeded` job processes
   nothing.

The unique index on `(JobId, ItemKey)` is the backstop, not the mechanism: it
guarantees the duplicate cannot be persisted even if the skip logic is wrong.
That pairing — application logic for the normal path, a constraint for the case
you did not think of — is the same one M07 used for idempotent order submission
in Node.
