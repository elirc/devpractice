# Testing

The goal is to catch defects that matter: data loss, cross-owner access, wrong
grading, duplicate credit, and content updates that destroy history. Coverage
percentage is not a target.

## Layers

| Layer | Tool | Runs against |
| --- | --- | --- |
| Business rules | vitest | pure functions, injected clock |
| API integration | vitest | a **real** disposable PostgreSQL with migrations applied |
| Components | vitest + React Testing Library | jsdom, behaviour not snapshots |
| Journeys | Playwright | the built app |
| Content | `dp-content` | authored packages, executing solutions and mutants |

**Persistence tests use a real database.** Mocking the repository and then
claiming synchronisation works would prove nothing about ordering, constraints
or transactions — the things that actually break.

## Commands

```bash
pnpm test                    # every workspace
pnpm --filter @devpractice/learning-core test
pnpm --filter @devpractice/api test:integration
pnpm --filter @devpractice/web test:e2e

pnpm content:validate -- --target v1
node --import tsx packages/content-tools/tests/gate-harness.mjs
```

## Rules

- **Deterministic fixtures and a controlled clock.** No real sleeps, no
  dependence on wall-clock ordering, no reliance on external services.
- **Never assert a copied implementation constant.** A test that restates the
  code proves the code was copied correctly, not that it is right.
- **Avoid whole-page snapshots.** Assert behaviour; inspect layout deliberately.
- **Do not weaken a test to accommodate an observed defect** without first
  checking the requirement. If an assertion is intentionally changed, record why.

## Acceptance matrix

| ID | Scenario |
| --- | --- |
| A01 | Two synthetic users; every cross-owner request denied |
| A02 | Progress survives a service restart and a second browser context |
| A03 | Duplicate submission → one event, one XP award |
| A04 | Conflicting draft edit → 409, both texts recoverable |
| A05 | Concurrent review responses → one schedules; retry returns the original |
| A06 | Reveal solution → reset → pass still shows solution assistance |
| A07 | Runner isolation: infinite loop, host access, oversized output, cancellation |
| A08 | A runtime-correct but type-invalid solution fails the compiler gate |
| A09 | Invalid reference blocks publication; competing publish → 409 |
| A10 | Archived content keeps notes, bookmarks and attempts |
| A11 | 4/5 with criticals qualifies; revealed repeat is practice-only |
| A12 | Full mobile journey at 360 px with no lost input |
| A13 | Fresh starter installs, baseline passes, mission fails for the intended reason, solution passes |
| A14 | Interrupted save → Unsaved; reconnect fetches current revision |
| A15 | Export parses; a database backup restores with the same counts |
| A16 | Core journeys work with no LLM credentials configured |
| A17 | Release inventory meets minimums; mutants rejected; no empty bodies |
| A18 | Earlier release can be reactivated without deleting newer attempts |

## Content gates

The `dp-content` gate is itself tested. `curriculum/fixtures/` holds one valid
package and twelve that each break exactly one rule; `gate-harness.mjs` asserts
that the matching check fires for each and stays silent for the valid one.

If you add a validator check, add its fixture. A validator that never fails is
worthless.

## Performance targets

Initial engineering targets in a documented environment, not guarantees:

- Today, curriculum and progress p95 under 500 ms on a seeded catalog of 1,000
  lessons and 10,000 exercises, warm service.
- Visible primary content within 3 s on simulated fast 4G.
- Initial compressed JS under 300 KiB; editor, compiler and interpreter lazily
  loaded and excluded from the dashboard bundle.

A missed target is recorded with its measurement and cause. It is not rounded up
to a pass.
