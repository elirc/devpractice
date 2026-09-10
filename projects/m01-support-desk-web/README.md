# M01 — Support desk ticket interface

**Work type:** build from a scaffold
**Stack:** React + TypeScript + Vite
**Prerequisites:** chapters 1–8
**Platform mission id:** `m01-support-desk-web`

You are building the first screen of a small internal support desk. The data
layer is already decided: a `TicketApi` adapter interface with a mock
implementation. Mission M02 later swaps that mock for a real HTTP backend
**without changing your components**, which is the point of the adapter.

Everything here is fictional. There are no real customers, credentials or
external services.

## What you are implementing

1. A ticket **list** showing title, status and customer.
2. A **status filter** (all / open / pending / closed) that does not mutate the
   fixture data.
3. A **create ticket** form with validation.
4. A routable **ticket detail** view.

## Setup

```bash
cd projects/m01-support-desk-web/starter
npm install
npm run dev        # http://localhost:5174
```

## The two check commands are different on purpose

```bash
npm run check:baseline   # MUST pass before you write any code
npm run check:mission    # MUST fail before you start, and pass when you are done
```

`check:baseline` proves the scaffold, the toolchain and the mock API work. If it
fails, your environment is broken — fix that first.

`check:mission` is the assignment. It fails on a fresh checkout because the
features do not exist yet. That is expected and is **not** a broken setup.

## Acceptance criteria

- [ ] Title is required and trimmed; a whitespace-only title is rejected.
- [ ] Validation errors are programmatically associated with their input
      (`aria-describedby` / `aria-invalid`), not just coloured text.
- [ ] Submitting disables the button so a double click cannot create two tickets.
- [ ] Loading, empty, error and success states are each visible and distinct.
- [ ] Filtering does not mutate the fixture array.
- [ ] Ticket detail is reachable by its own route.
- [ ] Every control is reachable by keyboard.
- [ ] At a 360 px viewport the page does not scroll horizontally.
- [ ] A delayed response does not produce a stuck spinner or a lost update.

## Hints

Reveal these in the app rather than reading them here if you want the assistance
recorded honestly.

1. Decide who owns each piece of state before writing components. The filter is
   interface state; the tickets are server state. They do not belong in the
   same place.
2. Validation has two jobs: deciding whether the value is acceptable, and
   telling the user which field is wrong. Keep the first one a pure function so
   you can test it without rendering anything.
3. After a successful create, the list must reflect the new ticket. Either
   refetch the list, or apply the returned record — but pick one deliberately
   rather than mutating your local array and hoping it matches the server.

## Reference solution

`solution/src/` holds a complete implementation. It replaces `starter/src/`:

```bash
npm run verify:solution   # copies solution over a temp copy and runs both checks
```

Read it only after your own attempt — the app records a solution reveal.

## Reflection

Explain what belongs in component state versus server state in this feature, and
what would change if two dispatchers had the same ticket list open.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `npm run dev` exits immediately | port 5174 in use | `npm run dev -- --port 5175` |
| Tests cannot find `document` | jsdom environment not picked up | confirm `environment: 'jsdom'` in `vite.config.ts` |
| `check:baseline` fails on a fresh clone | dependency install incomplete | delete `node_modules` and re-run `npm install` |
