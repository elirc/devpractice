# Outstanding work, in dependency order

Read `03-environment.md` first. Nothing below is blocked by anything above it
except where it says so.

V2 and V3 are authored, verified, built and **published**; see `01-state.md` for
exactly what that claim covers and what it does not. What is left is the platform
re-verification that publication invalidates, and the V1 leftovers.

---

## 1. Re-run the platform gate set against the published catalogue

**Publication is done.** V2 (409 items) and V3 (613 items) are published and the
API exposes 1 track and 30 chapters. See `01-state.md` for release ids and for the
import body-limit defect that publishing surfaced and that is now fixed.

What is left is re-verification. Every gate in `05-verification.md`, in the order
given there. On this machine that is a multi-hour, strictly sequential job: the
two API integration suites share one database and must not overlap, and the memory
ceiling means one heavy suite at a time. Budget for it properly.

**Both API integration suites have already been re-run** against the published
catalogue and pass unchanged: foundation 23/23, learning 45/45. They were the
priority because `apps/api` actually changed (the content import route gained a
route-level `bodyLimit`). What remains is the learning-core, runner and web unit
suites, the remaining typechecks, and Playwright.

Then:

- Playwright, **twice**. Two runs of identical code once gave 10/2 then 9/3.
- §14.3 performance against 30 chapters rather than 12.
- Open the app and confirm the curriculum lists all 30 chapters and that a chapter
  page shows its mission. The published data says both are right; seeing it render
  is a different claim from querying it.

## 2. A15 — the backup and restore drill

Never performed, in V1 or since. Restore a real database backup into a clean
environment and compare record counts. Note that there is no tooling for this
yet and no written procedure beyond `docs/operations.md`; this is undiscovered
work, not a checkbox, and the restore path may need building before it can be
drilled.

---

## 3. Smaller V1 leftovers, unchanged

- **Only Chromium** has ever been exercised, in the runner and in e2e. WebKit and
  Firefox are unverified.
- The `docker compose` local-dev path is unverified. Docker does not start here.
  M04's stale compose file was removed during this work; the remaining compose
  files in M01–M03 are still unverified.
- `localOnly` is never emitted by the API, but `ExercisePanel` reads it to explain
  browser-unrunnable work and link to a mission (spec §3.3, §4.3). No release has
  a `local-project` exercise, so nothing renders badly today — the first one
  authored silently loses that affordance.
- Two synthetic accounts exist in the dev database:
  `e2e-runner@devpractice.test` and `runner-verify@devpractice.test`. Delete if
  unwanted.

---

## 4. Findings recorded but not fixed

All three are written up in `docs/known-limitations.md`. None blocks anything;
each is a deliberate deferral rather than an oversight.

- **NU1903 on the .NET missions.** `Microsoft.NET.Test.Sdk` 17.11.1 pulls a
  high-severity advisory on `System.Security.Cryptography.Xml` 9.0.0 into all four
  .NET mission test projects. Test-only, not in the API a learner runs. Fixing it
  means moving the test SDK forward and re-running A13 for four missions.
- **V1's three asset checksums cannot be reproduced** by `dp-content assets`. The
  method that produced them was not recorded. They were left alone because they
  belong to a published release. Every V2 and V3 asset checksum is reproducible.
- **Five `verify.mutant-survived` warnings** across the three releases, on
  `v1-e014`, `v2-e002` and `v3-e023`. Each was judged by running the mutated
  source and each is an equivalent mutant; the `v3-e023` pair cannot be
  distinguished by any input at all. No solution was rewritten to silence one, and
  none should be.
