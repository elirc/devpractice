# Data model

PostgreSQL, accessed through Prisma. Full schema: `prisma/schema.prisma`.

Conventions: `timestamptz` everywhere, timestamps generated **server-side** in
UTC, UUIDs for operational records, stable strings for authored content. The
client clock is never trusted for ordering. Database constraints back up every
application rule that matters.

## Content: items, versions, releases

The heart of the model, and the reason content can be corrected without
destroying learning history.

```
ContentItem   (stable id, e.g. "js-arrays-filter-open")
  └── ContentVersion  (immutable; version + masteryRevision + payload + checksum)
        └── ReleaseItem  (which version a given release pins)
              └── ContentRelease  (draft | published | superseded)
```

- **Attempts point at an immutable `ContentVersion`.** What was graded stays
  knowable forever.
- **Notes, bookmarks and lesson progress point at the stable `ContentItem` id.**
  They survive edits, and they survive the item being archived.
- **A published release is an immutable map of item id → version id.**
  `User.activeReleaseId` moves inside the same transaction that publishes.

### version vs masteryRevision

| Change | Effect |
| --- | --- |
| Typo, clearer wording | `version++`, mastery unchanged — evidence stands |
| Required behaviour, grading cases, objectives, solution | `masteryRevision++` — prior evidence kept and visible, new practice earns its own |

A version number is never reused with different bytes.

### Projected columns

`ContentVersion` duplicates `kind`, `parentId`, `sortOrder`, `title` and
`primaryConceptId` out of the JSON payload into indexed columns, and
`ReleaseItem` carries them too. Rendering a curriculum page must not scan every
JSON document — the catalog is meant to stay fast at 1,000 lessons.

## Owner records

| Table | Notes |
| --- | --- |
| `User` | one owner; `normalizedEmail` unique, display form kept separately |
| `Session` | stores the **hash** of the token, plus a per-session `csrfSecret` |
| `Attempt` | outcome, gradingOrigin, assistance, result, source snapshot (≤64 KiB) |
| `RevealEvent` | lifetime hint/solution reveal history per `(item, masteryRevision)` |
| `LessonProgress` | status + optimistic `version` |
| `ChapterPlacement` | placed-out state, separate from lesson completion |
| `PlacementAttempt` | score, qualified, `practiceOnly` for revealed repeats |
| `ExerciseDraft` / `DraftSnapshot` | live draft + at most 20 recoverable snapshots |
| `ReviewState` / `ReviewEvent` | schedule with `revision`; append-only history |
| `Note` / `Bookmark` | revision-checked; notes soft-delete |
| `MissionProgress` | checklist, self-reported report, repo URL, revision |
| `XpAward` | unique `(userId, awardKey)` — the anti-double-count guarantee |
| `ActivityEvent` | the Today feed; a plain log, **not** event sourcing |
| `MutationReceipt` | `(userId, clientEventId)` → stored response |
| `LoginAttempt` | rate limiting per email + source address |

## Invariants worth stating out loud

1. **Idempotency** — `MutationReceipt` has a composite primary key of
   `(userId, clientEventId)`. Receipt and domain write share one transaction.
2. **XP cannot double-count** — unique `(userId, awardKey)`, enforced by the
   database rather than by careful code.
3. **Ownership** — every owner table carries `userId` and every query scopes by
   it. Tested with a second synthetic user (acceptance A01).
4. **Concept status is derived**, not stored. There is no second, editable copy
   of mastery that can drift from the attempts that justify it.
5. **Deletion is conservative** — attempts and content history are the learning
   record and are retained by default. Only draft snapshots beyond 20, expired
   sessions and old mutation receipts are pruned.

## Size limits

| Field | Limit |
| --- | --- |
| Draft source, attempt source | 64 KiB |
| Note body / title | 20,000 / 200 characters |
| Import package | 10 MiB, ≤2,000 items |

Size is checked **before** expensive parsing. Repository URLs must be http(s)
and are rejected if they embed credentials; the server stores them as links and
never fetches them.

## Indexes

`Attempt(userId, exerciseVersionId, createdAt)`,
`ReviewState(userId, dueAt)`,
`Note(userId, updatedAt)`,
`MissionProgress(userId, status)`,
`ActivityEvent(userId, createdAt, id)`,
`ReleaseItem(releaseId, kind, parentId, sortOrder)`.

The `ActivityEvent` index includes `id` so the feed cursor has a total order.
