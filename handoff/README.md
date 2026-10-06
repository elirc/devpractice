# DevPractice — handoff to a fresh session

> **Status note (2026-10-06).** Frozen session handoff, last updated 2026-09-11 and
> committed as `1c391f5`. Commands and paths describe the original build machine
> (Windows, Git Bash tool syntax). Re-check anything machine-specific before relying
> on it.

Read these files in order. They are written for a model with **no prior context**
on this build. If you only want to run the thing, jump to `06-cold-start.md`.

| File | What it tells you |
|---|---|
| `01-state.md` | What exists, what is verified, what is not. Start here. |
| `02-outstanding.md` | The remaining work, ordered, with exact commands. |
| `03-environment.md` | This machine's constraints. Read before running anything. |
| `04-gotchas.md` | Traps that cost hours. Read before debugging anything. |
| `05-verification.md` | Exact commands to reproduce every gate. |
| `06-cold-start.md` | Getting from a fresh clone or reboot to a running app, plus a map of where things live. |

## The 30-second version

This repository (checked out on the build machine as `opusboot1`) is **DevPractice**, a private single-owner
learning platform built from `docs/product-spec.md` (the authoritative
specification — read it before changing behaviour).

- **V1 is COMPLETE, verified and published.** Platform, 12 chapters, 3 missions.
  Every acceptance gate except A15 was executed.
- **V2 and V3 content is COMPLETE, assembles as full releases, and is PUBLISHED** (2026-09-11). 30 chapters,
  90 lessons, 270 exercises, 180 review cards, 150 placement items, 12 missions —
  the spec §2.2 combined baseline, hit exactly. Structural validation is green for
  all three releases.
- **The missions are verified.** See `01-state.md` for exactly how many and which;
  that number is the one thing in this folder most likely to be stale, because it
  changed during the last session.
- **What is left** is the platform re-verification that publication invalidates
  (only the API integration and content-tools suites have been re-run) and the A15
  restore drill. Both are in `02-outstanding.md` with commands. The behavioural
  content gate has already run green on assembled V2 and V3.

## Rules that are not negotiable

These come from the spec and from failures that already happened here:

1. **Never claim a check passed unless you ran it.** Use the spec §1.3 labels:
   implemented / verified / content authored / content validated / deferred /
   blocked. A green reference solution proves one implementation passes, not
   that the grader rejects wrong ones.
2. **Never weaken a test to make it pass.** Several tests in this repo asserted
   behaviour they never exercised; each was found only because someone made a
   test fail loudly instead of skipping.
3. **Do not run `pnpm install` casually.** Concurrent installs destroyed this
   workspace four times. See `03-environment.md`.
4. **Learner code never reaches host eval.** The QuickJS interpreter boundary is
   the security model. Do not "simplify" it.
5. **One heavy process at a time.** The OS memory killer has stopped background
   test runs here. This is not caution, it is the observed failure mode.
6. **The validator checks references forwards only.** A chapter the track does not
   list, and a mission no chapter lists, both validate green and are invisible in
   the app. Both shipped broken once. `curriculum/README.md` has the rule.
