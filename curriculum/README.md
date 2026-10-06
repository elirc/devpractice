# Curriculum

Authored learning content. Everything here is **data**: the application never
executes it.

## Files

| Path | Purpose |
| --- | --- |
| `concepts.json` | the stable concept-id catalog (193 ids: 115 `v1`, 32 `v2`, 46 `v3`) |
| `release.json` | V1 release manifest: which chapter files form the snapshot |
| `release-v2.json` | V2 release manifest |
| `release-v3.json` | V3 release manifest |
| `chapters/*.json` | one file per chapter, `{ "items": [...] }` |
| `chapters/v[123]-track.json` | the track item, one file per release — see below |
| `chapters/v[123]-missions.json` | the mission items for each release |
| `verification.json` | starter exemptions and author-declared mutants |
| `fixtures/` | the valid and deliberately-broken packages the gate tests itself with |
| `dist/` | built snapshot packages, ready to import |

## Three releases, three manifests

A release is a **snapshot** (spec §10.1): a complete statement of everything in
it, not a diff. So `release-v2.json` re-lists every V1 chapter alongside its
own eight, and `release-v3.json` lists all thirty.

## One track item at three versions

The curriculum UI renders from `track.chapterIds`, so a chapter the track does
not list is unreachable however well it validates. But a release cannot list a
chapter it does not contain either, or it fails `reference.missing`.

`ContentVersion` is unique on `(itemId, version)` and a release pins each item to
ONE version, so the same `v1-track` item exists three times:

| File | Version | Chapters |
| --- | --- | --- |
| `chapters/v1-track.json` | 1 | the 12 V1 chapters |
| `chapters/v2-track.json` | 2 | those 12 plus the 8 V2 chapters |
| `chapters/v3-track.json` | 3 | all 30 |

Each manifest lists exactly **one** of these. When adding chapters, the author
bumps `version` and leaves `masteryRevision` alone (spec §8.2). The **publisher**
then owns `masteryRevision`: `track.chapterIds` is listed in `BEHAVIOURAL_FIELDS`
(`packages/learning-core/src/content-diff.ts:27-28`), so each publish that adds
chapters classifies the track as a behavioural change and increments it. The live
V3 track is version 3, masteryRevision 3. That is expected, not drift.

Two reachability rules, now enforced by the validator because both shipped broken
once:

- the release's track file must list every chapter in the release
  (`reachability.chapter-unlisted`);
- some chapter's `missionIds` must list every mission in the release
  (`reachability.mission-unclaimed`). A mission's own `chapterPrerequisiteIds` is
  not the reverse edge and does not put it on a page.

What the validator still cannot judge is whether a mission is claimed by the
RIGHT chapter. Any chapter satisfies the check.

## Commands

```bash
pnpm content:validate                 # V1, every gate
pnpm content:validate -- --target v1  # plus the V1 inventory minimums
pnpm content:validate:v2              # V2, every gate, with --target v2
pnpm content:validate:v3              # V3, every gate, with --target v3

pnpm content:build                    # write dist/devpractice-v1-1.0.0.json
pnpm content:build:v2
pnpm content:build:v3

pnpm content:assets                   # V1 asset checksums vs the files on disk
pnpm --filter @devpractice/content-tools assets:v3
```

Or call the CLI directly, which is what the scripts do:

```bash
cd packages/content-tools
./node_modules/.bin/tsx src/cli.ts validate --manifest release-v2.json --target v2
```

`--skip-verify` skips the behavioural gate. Run **without** it at least once, or
no solution or starter is ever executed. Confirm the report says
`backend: quickjs`; `node:vm` means the real runner failed to load.

`assets` recomputes the checksum of every bundled asset directory and compares it
with the manifest. It reports rather than rewrites: a manifest is authored, and a
tool that silently re-stamped a checksum would make a changed bundle look
unchanged in review. The algorithm is documented in
`packages/content-tools/src/asset-checksum.ts`.

## Before authoring

Read [docs/content-authoring.md](../docs/content-authoring.md), then read
`fixtures/valid-chapter.json` — a complete, passing one-chapter package.

Two rules that catch most first attempts:

1. Every concept id you reference must already exist in `concepts.json`.
2. A starter must **fail** at least one case. If it passes, the exercise teaches
   nothing, and the gate rejects it.
