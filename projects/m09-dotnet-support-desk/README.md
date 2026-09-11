# M09 — The support desk API, in ASP.NET Core

**Work type:** build from a scaffold
**Stack:** C# / ASP.NET Core minimal APIs + EF Core + PostgreSQL
**Prerequisites:** chapters 1 to 5 of the .NET chapters, and M02
**Platform mission id:** `m09-dotnet-support-desk`

You have built this API before, in Node, in M02. This is the same contract in
C#. That is deliberate: with the requirements already familiar, the whole of your
attention is free for what actually differs — a type system you cannot opt out
of, EF Core instead of Prisma, and minimal API routing instead of Fastify.

The existing React frontend from M01 must work against your server **unchanged**.
If it needs a single edit, the contract moved, and that is a finding.

## Setup

PostgreSQL must be reachable. The starter defaults to
`Host=127.0.0.1;Port=5440;Username=postgres` and uses two databases of its own,
`m09_supportdesk` and `m09_supportdesk_test`, separate from the DevPractice
platform database and from every other mission's.

```bash
cd projects/m09-dotnet-support-desk/starter
dotnet restore
dotnet build
```

The SDK is pinned in `global.json` to .NET 10. The first `dotnet restore` on a
cold NuGet cache takes a while; that is the package download, not a hang.

`.env.example` documents the two environment variables the code reads,
`SUPPORTDESK_CONNECTION` and `SUPPORTDESK_TEST_CONNECTION`. **Nothing loads a
`.env` file for you** — .NET has no equivalent of dotenv here. Either export them
in your shell or rely on the defaults baked into `Program.cs` and `ApiFixture`,
which already point at the two databases above.

There are no EF Core migrations in this mission. The schema is created with
`EnsureCreatedAsync`, which the test fixture calls and `tools/SeedRunner` calls
for local play. Migrations are chapter 6's subject and M10's.

```bash
dotnet run --project src/SupportDesk.Api     # http://localhost:5109
dotnet run --project tools/SeedRunner        # create the schema and load fixtures
```

## The two check commands

```bash
dotnet test --filter Category=Baseline   # MUST pass before you start
dotnet test --filter Category=Mission    # MUST fail before you start
```

They are separate on purpose, so you can always tell an intentionally incomplete
assignment from a broken setup. `dotnet test` with no filter runs both.

## Identity here is training scaffolding, NOT authentication

A request names its dispatcher in a header. There is no credential and nothing is
verified. Real authentication and authorization policies are chapter 8's subject.
This starter does not implement authentication and does not claim to.

## What you are implementing

Everything in `src/SupportDesk.Api/TicketEndpoints.cs`. The contract:

| Endpoint | Behaviour |
| --- | --- |
| `POST /tickets` | validate, 201 with the stored record, title trimmed |
| `GET /tickets` | cursor pagination, total ordering, bounded page size |
| `GET /tickets/{id}` | 404 for an unknown id |
| `GET /tickets/{id}/comments` | comments for one ticket |
| `POST /tickets/{id}/comments` | reject a comment on a ticket that does not exist |

## Acceptance criteria

- [ ] `POST /tickets` rejects an empty or whitespace-only title with 400 and a
      field error, and writes no row.
- [ ] A created ticket comes back with its title trimmed.
- [ ] `GET /tickets` orders by `CreatedAt` then `Id`, so the order is total.
- [ ] Cursor pagination covers every row exactly once, with no duplicates.
- [ ] Page size is bounded: a caller cannot ask for ten thousand rows.
- [ ] An empty listing is an empty page, not an error.
- [ ] An unknown ticket id is 404, not 500 and not an empty 200.
- [ ] A comment requires an existing ticket the caller owns; otherwise 404 and no
      row is written.
- [ ] A comment with an empty body is 400 and writes nothing.
- [ ] A dispatcher sees only their own tickets, enforced in the query.
- [ ] The M01 React frontend works against this API with no changes.

## Hints

1. Write the request and response records first. `record` types with non-nullable
   properties make several of the validation criteria unreachable by accident,
   which is the first real difference from the Node version.
2. Cursor pagination needs the same compound `(CreatedAt, Id)` key as M02 did.
   In LINQ that is `OrderBy(...).ThenBy(...)` plus a predicate comparing the pair;
   the tuple comparison you would write in SQL does not translate, so express it
   as the explicit `>` / `=` and `>` pair.
3. Scope by dispatcher **in the query**, not after it. A query that cannot return
   another dispatcher's row cannot leak one, and `Where` before `ToListAsync` is
   where that belongs.

## What to write up

- Three things that genuinely differ from the Node implementation, and one that
  only looks different.
- Where the C# type system removed a runtime check you needed in Node, and where
  it did not help at all.
- Whether the frontend needed any change, and what that tells you about the
  contract.

## Reference solution

`solution/src/SupportDesk.Api/TicketEndpoints.cs` replaces the starter file of
the same path. Nothing else changes.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `No project or solution file found` | you are not in `starter/` | `cd` there; `SupportDesk.sln` lives at its root |
| `Npgsql.NpgsqlException: Connection refused` | PostgreSQL is not listening on 5440 | start it, or set `SUPPORTDESK_TEST_CONNECTION` |
| `relation "Tickets" does not exist` | the schema was never created | run the baseline tests, or `dotnet run --project tools/SeedRunner` |
| Mission tests pass on a fresh checkout | you are running a modified `TicketEndpoints.cs` | restore it from the starter |
| The frontend gets a CORS error | it is on an origin `Program.cs` does not list | add your dev origin to the CORS policy |
