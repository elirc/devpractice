# M12 — The same job, cancelled and rerun, in two languages

**Work type:** extend existing code
**Stack:** C# / ASP.NET Core hosted service + EF Core + PostgreSQL
**Prerequisites:** .NET chapters 9 and 10, and M08
**Platform mission id:** `m12-dotnet-background-compare`

You built this job once already, in Node, in M08. This is the same job in C#, and
the mission is only half about the code. The other half is being able to say what
genuinely differs and what merely looks different.

`ReportRunner.RunAsync` processes five source items and writes a row for each. It
works on a first run on a quiet machine. Two things are missing.

**It takes a `CancellationToken` and never looks at it.** A token nobody checks
cannot stop anything, so a deployment or a timeout has no polite way to interrupt
the run: it either finishes or is killed mid-write. Cancellation in .NET is
cooperative, exactly as an `AbortSignal` is in Node. The type is different, the
discipline is identical.

**And a rerun repeats itself.** When the first attempt fails on the fourth item,
three rows are already committed. Running it again writes those three a second
time — or would, if the unique index did not stop it, which is worth thinking
about: the constraint turns silent duplication into a loud failure, and a loud
failure is still a failure. Resuming means finishing the remaining work, not
repeating the finished work.

## Setup

PostgreSQL must be reachable. This mission uses `m12_reports` and
`m12_reports_test`, separate from the platform database and from every other
mission's.

```bash
cd projects/m12-dotnet-background-compare/starter
dotnet restore
dotnet build
```

The SDK is pinned in `global.json` to .NET 10. `.env.example` documents
`REPORTS_CONNECTION` and `REPORTS_TEST_CONNECTION`; nothing loads a `.env` file for
you, and the code defaults already point at those two databases. The schema is
created with `EnsureCreatedAsync` rather than a migration.

## The two check commands

```bash
dotnet test --filter Category=Baseline   # MUST pass before you start
dotnet test --filter Category=Mission    # MUST fail before you start
```

The baseline proves the database is reachable, a clean run writes one row per
source item, and the unique index on `(JobId, ItemKey)` rejects a duplicate. The
mission checks are about cancellation and the second run.

## At-least-once invocation, exactly-once effect

The same distinction M08 insisted on, and it does not change language. This runner
is invoked at least once and may be invoked again at any moment. You cannot make
the invocation happen exactly once. You can make its committed effect exactly
once. Never say "exactly once" without saying which.

## Acceptance criteria

- [ ] A cancelled run stops partway: fewer rows are written than there are source
      items, and `OperationCanceledException` escapes.
- [ ] A rerun after a partial failure completes the job without duplicating the
      rows already committed, and the attempt count reflects both attempts.
- [ ] Re-running a job that already succeeded processes nothing and adds no rows.
- [ ] A clean run still writes exactly one row per source item.

## Hints

1. Cancellation is cooperative. `ct.ThrowIfCancellationRequested()` inside the loop
   is the whole mechanism — the question is where in the loop to put it, so that
   you stop between units of work rather than half-way through one.
2. Before processing, ask the database which items this job has already committed,
   and skip those. That single query is what turns a rerun into a resume.
3. Consider what a cancelled job should look like afterwards. `Failed` is
   misleading, because nothing failed. Leaving it `Queued` with its committed
   effects intact means the next pass finishes it, which is what makes cancellation
   safe to use at all.

## What to write up

This is the comparative mission, so the write-up is the deliverable as much as the
code:

- Why cancellation is cooperative, and what happens to a token that is never
  checked.
- How your runner distinguishes work already committed from work still to do, and
  why that makes a rerun safe.
- The state you leave a cancelled job in, defended against at least one
  alternative.
- **One thing that genuinely differs between the .NET and Node versions of this
  job, and one thing that only looks different.** Be specific. "C# is typed" is not
  an answer; "the token is a parameter you thread through rather than an ambient
  signal, so an un-cancellable call path is visible in the signature" is.

## Reference solution

`solution/src/Reports.Api/ReportRunner.cs` replaces the starter file of the same
path. Nothing else changes.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `No project or solution file found` | you are not in `starter/` | `cd` there; `Reports.sln` lives at its root |
| `Npgsql.NpgsqlException: Connection refused` | PostgreSQL is not listening on 5440 | start it, or set `REPORTS_TEST_CONNECTION` |
| A rerun fails with a unique violation | the rerun is repeating committed work | read the committed `ItemKey`s and skip them |
| The cancellation test never cancels | the token is checked outside the loop, or not at all | check it per item |
| A cancelled job is later skipped forever | it was left `Failed` or `Running` | decide what state makes it resumable, and defend it |
