# DevPractice — handoff to a fresh session

Read these five files in order. They are written for a model with **no prior
context** on this build.

| File | What it tells you |
|---|---|
| `01-state.md` | What exists, what is verified, what is not. Start here. |
| `02-outstanding.md` | The remaining work, ordered, with exact commands. |
| `03-environment.md` | This machine's constraints. Read before running anything. |
| `04-gotchas.md` | Traps that cost hours. Read before debugging anything. |
| `05-verification.md` | Exact commands to reproduce every gate. |

## The 30-second version

`C:\Users\Owner\Desktop\opusboot1` is **DevPractice**, a private single-owner
learning platform built from `docs/product-spec.md` (the authoritative
specification — read it before changing behaviour).

- **V1 is COMPLETE and verified.** Platform + 12 chapters + 3 missions. Every
  acceptance gate except A15 was executed. Commits `dacb8ad`, `b147d96`.
- **V2 and V3 CHAPTERS are complete and validated.** 18 chapters, committed at
  `1d81c1e`.
- **V2 and V3 MISSIONS are incomplete.** Code exists for M04-M11, M12 does not
  exist, and none of it has mission content items or A13 verification. This is
  the main outstanding work.
- **One known defect blocks V2/V3 navigation**: the track item lists only the 12
  V1 chapters. See `02-outstanding.md` item 1.

## Rules that are not negotiable

These come from the spec and from failures that already happened here:

1. **Never claim a check passed unless you ran it.** Use the spec §1.3 labels:
   implemented / verified / content authored / content validated / deferred /
   blocked. A green reference solution proves one implementation passes, not
   that the grader rejects wrong ones.
2. **Never weaken a test to make it pass.** Three tests in this repo asserted
   behaviour they never exercised; each was found only because someone made a
   test fail loudly instead of skipping.
3. **Do not run `pnpm install` casually.** Concurrent installs destroyed this
   workspace four times. See `03-environment.md`.
4. **Learner code never reaches host eval.** The QuickJS interpreter boundary is
   the security model. Do not "simplify" it.
