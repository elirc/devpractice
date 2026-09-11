# Authoring content

How lessons get written, checked and published. This is the workflow a content
agent or a human author follows; the CLI is the gate that decides whether the
work is good enough to publish.

## The shape of the content

```
track
└── chapter                    (3 lessons + 1 placement assessment + mission links)
    ├── lesson                 (1–3 objectives)
    │   ├── exercise × 3
    │   └── review_card × 2
    └── assessment             (exactly 5 separately authored items)
```

Everything is data. Prose is Markdown strings; grading definitions are static
JSON. Imported content is **never** executed, compiled into route validators, or
turned into MDX components.

## Files on disk

| Path | Purpose |
| --- | --- |
| `curriculum/concepts.json` | the stable concept-id catalog (193 ids: 115 `v1`, 32 `v2`, 46 `v3`) |
| `curriculum/release.json` | the V1 release manifest: which chapter files make up the snapshot |
| `curriculum/release-v2.json`, `release-v3.json` | the V2 and V3 manifests; select one with `--manifest` |
| `curriculum/chapters/*.json` | one file per chapter: `{ "items": [...] }` |
| `curriculum/verification.json` | starter exemptions and author-declared mutants |
| `curriculum/fixtures/*.json` | the valid and deliberately-broken packages the gate tests itself against |
| `curriculum/dist/*.json` | built snapshot packages, ready to import |

### Snapshot mode, and why a chapter file is not a package

V1 packages are `mode: "snapshot"`: a **complete desired release manifest**.
Adding a chapter does not mean uploading that chapter — it means re-assembling
every existing chapter plus the new one into a fresh snapshot.

`dp-content build` does this for you from `release.json`. If you write a chapter
file and forget to list it there, the CLI prints it as an orphan rather than
silently leaving it out.

`--manifest <file>` selects a manifest other than `release.json`, which is how V2
and V3 are assembled. Every chapter file listed by a manifest is in that snapshot
and nothing else is, so the orphan note is relative to the manifest you chose: on
a V1 run it lists every V2 and V3 file, which is correct and expected.

### Reachability is checked in both directions

A chapter has to be listed by its release's track, and a mission has to be listed
by some chapter's `missionIds`. Both are errors
(`reachability.chapter-unlisted`, `reachability.mission-unclaimed`) because the
UI renders from those two arrays, and content nothing points at is complete,
correct and invisible. A mission's `chapterPrerequisiteIds` is about ordering, not
placement.

### The track item exists once per release

Because a release is a snapshot, the track item has to list exactly the chapters
that release contains — so the same `v1-track` item exists at version 1, 2 and 3
in three separate files, and each manifest pins one of them. `curriculum/README.md`
has the table. Two reachability edges the validator does not check are documented
there too; both have already shipped broken once.

## Concept ids

Concept ids are the spine of the evidence model. They are declared once in
`curriculum/concepts.json` and only referenced by content. An id is **never
reused for a different idea** — evidence recorded against `js.array-filter` must
keep meaning what it meant when it was recorded.

They look like `js.array-filter`, `ts.narrowing`, `http.status-codes`,
`auth.resource-ownership`. Shared ideas can appear in several tracks.

Every exercise declares one `primaryConceptId` (which must also appear in its
`conceptIds`), because evidence needs a single unambiguous target.

## Commands

```bash
pnpm content:validate                 # assemble the snapshot and run every gate
pnpm content:validate -- --target v1  # also enforce the V1 release inventory
pnpm content:build                    # validate, then write curriculum/dist/<id>-<version>.json

# work on one file without assembling the whole release
node --import tsx packages/content-tools/src/cli.ts validate \
  --package curriculum/fixtures/valid-chapter.json

# structural checks only, skipping solution execution
... validate --skip-verify

# machine-readable output
... validate --json
```

Every command exits non-zero when an error-severity issue is present, so it
works as a CI gate unchanged.

## What the gate checks

**Structure** — schema shape; unknown fields (reported, never silently
ignored); forbidden runtime fields (`ownerId`, `progress`, `xp`, `publishedAt`,
…); duplicate ids and reused version numbers; every reference resolving to an
item of the right kind; back-references agreeing in both directions; prerequisite
cycles; sortOrder collisions and lessonIds order disagreeing with lesson
sortOrder; concept ids existing in the catalog; every chapter objective being
practised by at least one exercise in that chapter.

**Prose** — placeholder text (`TODO`, `TBD`, lorem ipsum, "coming soon");
`javascript:` and `data:` links; body text duplicated between items; hints that
repeat one another instead of adding information.

**Grading** — a correct option existing; single-choice items having exactly one;
every option carrying an explanation, so a wrong answer teaches; duplicate
option and case ids; unsupported runner features (imports, `fetch`, `document`,
`process`); the starter actually defining the entrypoint; and cases whose
expected values are all identical, which a constant implementation would pass.

**Placement independence** — assessment items must be separately authored. A
placement item that duplicates a lesson exercise prompt is rejected.

**Behaviour** — this is the part that matters most:

1. The reference solution must pass every case.
2. The starter must **fail** at least one case. A starter that already passes
   means the exercise teaches nothing. The only exception is an explicit
   read-only worked example, declared with a reason in `verification.json`.
3. Deliberately wrong implementations must be **rejected**.

### Mutants

A grading definition is only trustworthy if it rejects plausible wrong answers.
The CLI generates them automatically and runs each through the same runner
contract as the real solution:

| Mutant | Severity | What it proves |
| --- | --- | --- |
| `constant-<value>` | required | cases distinguish more than one expected value |
| `identity-first-arg` | required | echoing the input back does not pass |
| `filter-accepts-all` | required | the selection predicate is actually tested |
| `mutates-input` | required | `assertInputUnchanged` is enforced |
| operator flips, off-by-one | heuristic | boundaries are exercised |

A surviving **required** mutant is an error: add a case that distinguishes it.
A surviving **heuristic** mutant is a warning, because it may be semantically
equivalent to the reference solution.

Author-specific mutants go in `curriculum/verification.json`:

```json
{
  "starterExemptions": {
    "js-worked-example-trace": "Read-only worked example: the learner traces output rather than editing code."
  },
  "declaredMutants": {
    "js-arrays-filter-open": [
      {
        "id": "counts-pending-too",
        "source": "function countOpen(t) { return t.filter(x => x.status !== 'closed').length; }",
        "rationale": "treats pending as open"
      }
    ]
  }
}
```

## A worked example

`curriculum/fixtures/valid-chapter.json` is a complete, passing one-chapter
package. It contains the `js-arrays-filter-open` exercise from the
specification, with the extra `uppercase-open-is-not-open` and `all-open` cases
that make its grading strong enough to reject the always-zero, count-all and
input-mutating mutants.

Read it before authoring your first chapter, and run:

```bash
node --import tsx packages/content-tools/tests/gate-harness.mjs
```

That harness proves each check fires on a fixture that breaks exactly one rule.
If you add a check, add its fixture too — a validator that never fails is
worthless.

## Authoring loop

Author **one chapter at a time**, in this order:

1. Agree the objectives and the exercise inventory. Which three exercises, of
   which types, evidencing which concepts?
2. Write the lesson bodies: business context, explanation, worked example,
   common mistakes, summary, references.
3. Implement solutions, starters and behavioural cases. Run the gate.
4. Review distractors, misconceptions and references. Every wrong option needs
   an explanation that names the misconception.

Volume must not run ahead of a stable schema and a demonstrated grader. Three
excellent chapters beat twelve that the gate has never executed.

### Exercise diversity

The gate enforces the V1 minimums so a release cannot quietly collapse into
multiple choice: at least 20 runnable function tasks, 24 debugging or
code-review tasks, and 12 explanation tasks with a rubric. Categories overlap
deliberately — one exercise can be both runnable and a debugging task.

### Hints

Exactly three, each adding something new: conceptual direction, then the
relevant mechanism, then near-solution guidance. The gate rejects duplicates,
but it cannot tell you that hint 2 says nothing hint 1 did not. Read them.

## Publishing

Draft import and publication are separate, deliberate steps:

1. `POST /content/imports` — validates and stores a **draft**. Learners are
   unaffected. The response summarises added, changed, archived and unchanged
   items, and which mastery revisions are affected.
2. Review the preview in the Content screen.
3. `POST /content/imports/:id/publish` — rechecks the checksum and the base
   release, then writes every version, membership row and the active-release
   pointer in one transaction. A competing publish returns 409 rather than
   silently overwriting newer content.

### Versions and mastery revisions

- Fixing a typo or clarifying an explanation → `version++`, `masteryRevision`
  unchanged. Existing completions and evidence stand.
- Changing required behaviour, grading cases, objectives or the solution →
  `masteryRevision++`. Prior evidence is kept and stays visible, the lesson
  shows "updated practice available", and new practice earns its own evidence
  rather than rewriting the original completion.

Never reuse a version number with different bytes. The gate rejects it.
