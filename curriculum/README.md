# Curriculum

Authored learning content. Everything here is **data**: the application never
executes it.

## Files

| Path | Purpose |
| --- | --- |
| `concepts.json` | the stable concept-id catalog (115 ids for chapters 1–12) |
| `release.json` | release manifest: which chapter files form the snapshot |
| `chapters/*.json` | one file per chapter, `{ "items": [...] }` |
| `verification.json` | starter exemptions and author-declared mutants |
| `fixtures/` | the valid and deliberately-broken packages the gate tests itself with |
| `dist/` | built snapshot packages, ready to import |

## Commands

```bash
pnpm content:validate                 # every gate
pnpm content:validate -- --target v1  # plus the V1 inventory minimums
pnpm content:build                    # write dist/<packageId>-<version>.json
```

## Before authoring

Read [docs/content-authoring.md](../docs/content-authoring.md), then read
`fixtures/valid-chapter.json` — a complete, passing one-chapter package.

Two rules that catch most first attempts:

1. Every concept id you reference must already exist in `concepts.json`.
2. A starter must **fail** at least one case. If it passes, the exercise teaches
   nothing, and the gate rejects it.
