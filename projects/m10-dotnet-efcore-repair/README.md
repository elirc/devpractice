# M10 — Three defects EF Core will not warn you about

**Work type:** repair existing code
**Stack:** C# / ASP.NET Core minimal APIs + EF Core + PostgreSQL
**Prerequisites:** .NET chapters 6 and 8, and M09
**Platform mission id:** `m10-dotnet-efcore-repair`

This service works for the person it was demonstrated to. The owning dispatcher
can read their own ticket, the list comes back with comment counts, and every
baseline check passes on the unrepaired starter. That is the point: none of the
three defects is visible from the outside while only one dispatcher is looking.

Two of them are visible only in the **SQL EF Core generates**, which is why this
mission gives you a SQL log and expects you to read it before you write anything.

## The three defects

1. **Ownership is checked after the row is loaded**, not in the query. A foreign
   ticket is materialised and then maybe filtered, and one path forgets.
2. **The list is an N+1.** A per-row `CountAsync` inside a loop, so ten tickets
   cost eleven round trips and nothing in the C# looks wrong.
3. **Graph loading where a projection belongs.** The detail endpoint `Include`s
   comments it never returns, and read paths track entities they will never save.

## Setup

PostgreSQL must be reachable. This mission uses `m10_efcore` and
`m10_efcore_test`, separate from the platform database and from every other
mission's.

```bash
cd projects/m10-dotnet-efcore-repair/starter
dotnet restore
dotnet build
```

The SDK is pinned in `global.json` to .NET 10. `.env.example` documents
`SUPPORTDESK_CONNECTION` and `SUPPORTDESK_TEST_CONNECTION`; nothing loads a `.env`
file for you, and the defaults in the code already point at the two databases
above. The schema is created with `EnsureCreatedAsync` rather than a migration.

## The two check commands

```bash
dotnet test --filter Category=Baseline   # MUST pass on the unrepaired starter
dotnet test --filter Category=Mission    # MUST fail on the unrepaired starter
```

A failing `Category=Mission` here is the defect set, not a broken environment.

## Read the SQL first

`SqlLog.cs` captures the statements EF Core issued, and the mission tests print
them when they fail. Run the mission tests, read the log, and count the SELECTs
for a list of two tickets. One look will tell you more than reading the C# will,
and that is the transferable skill: an ORM hides the cost of a query, so the only
way to know what you asked the database to do is to look at what it was sent.

## Acceptance criteria

- [ ] A dispatcher cannot read, list comments on, or rename another dispatcher's
      ticket: each returns **404**.
- [ ] A response about a foreign ticket leaks nothing about it — no customer name,
      no owner name, not in an error message either.
- [ ] Listing tickets issues **at most one SELECT**, regardless of how many
      tickets come back.
- [ ] The detail query does not join the comment graph it never returns.
- [ ] The comments endpoint queries the `Comments` table directly rather than
      pulling comments through the ticket graph.
- [ ] Read-only paths do not track entities.
- [ ] Comments still come back in order for the legitimate owner: the repair
      preserves behaviour.

## Why 404 and not 403

Confirming that a record exists is itself a disclosure: a 403 tells a caller the
id is real. Inaccessible and non-existent must be indistinguishable from outside.
This is the same policy M03 documented for the Node service, and the reason to
state it here is that the fix is the same shape in both stacks — scope the query,
do not filter the result.

## Hints

1. Run the mission tests and read the SQL they print on failure. Two of these
   defects exist only in the generated SQL.
2. A per-row `await db.Comments.CountAsync(...)` inside a `foreach` is an N+1. EF
   Core can count in the projection instead, so the count becomes part of the
   single query.
3. For ownership, put `&& t.OwnerId == owner` inside the `FirstOrDefaultAsync`
   predicate, so a foreign row is never materialised. For projection, drop the
   `Include` on the detail path — the response type has no comments field — and
   query `db.Comments` directly with `AsNoTracking()`.

## What to write up

- Which of the three defects you found from the SQL rather than from the C#.
- Why scoping the query is a different kind of fix from filtering the result, and
  what each one survives.
- What tracking was costing on the read paths, and how you would demonstrate it.
- The regression test that would have caught the ownership defect, and why it did
  not exist.

## Reference solution

`solution/src/SupportDesk.Api/TicketEndpoints.cs` replaces the starter file of
the same path. Nothing else changes.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `No project or solution file found` | you are not in `starter/` | `cd` there; `SupportDesk.sln` lives at its root |
| `Npgsql.NpgsqlException: Connection refused` | PostgreSQL is not listening on 5440 | start it, or set `SUPPORTDESK_TEST_CONNECTION` |
| The SQL log is empty | the interceptor was removed | restore `SqlLog.cs` from the starter |
| Baseline tests fail | environment, not assignment | fix the database before reading any mission test |
| Ownership tests pass but the count test fails | you fixed the leak, not the N+1 | look at the projection, not the predicate |
