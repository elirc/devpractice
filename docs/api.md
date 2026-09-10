# API contract

JSON over same-origin HTTPS under `/api/v1`. Timestamps are ISO 8601 UTC
strings. Route schemas are **application-authored static schemas**; imported
course data never becomes a route validator.

## Envelope

```jsonc
// success
{ "data": { }, "meta": { } }

// error
{ "error": { "code": "REVISION_CONFLICT", "message": "…", "fieldErrors": { }, "requestId": "…" } }
```

| Code | Status | Meaning |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | malformed input |
| `UNAUTHENTICATED` | 401 | missing or expired session |
| `FORBIDDEN` | 403 | access rejected |
| `NOT_FOUND` | 404 | unavailable, or not yours |
| `REVISION_CONFLICT` | 409 | stale `expectedRevision` |
| `IDEMPOTENCY_CONFLICT` | 409 | same event id, different body |
| `RELEASE_CONFLICT` | 409 | competing publish |
| `PAYLOAD_TOO_LARGE` | 413 | size limit |
| `CONTENT_INVALID` | 422 | readable but invalid content |
| `RATE_LIMITED` | 429 | too many attempts |
| `INTERNAL_ERROR` | 500 | generic message, `requestId` logged |

Pagination uses an opaque cursor over a **total** sort key, default limit 20,
maximum 100.

## Idempotency

Every learning and content mutation carries a `clientEventId` UUID (or an
`Idempotency-Key` header). The same id with the same canonical body returns the
original stored response; the same id with a different body returns
`IDEMPOTENCY_CONFLICT`. The receipt and the domain change are written in one
transaction, so a failed validation never leaves a success receipt.

Authentication lifecycle operations use their own session semantics and do not
store raw auth responses.

## Endpoints

### Authentication
| Method | Path | Behaviour |
| --- | --- | --- |
| GET | `/auth/csrf` | pre-session CSRF token for login |
| POST | `/auth/login` | validate credentials, create session |
| POST | `/auth/logout` | revoke current session |
| GET | `/auth/me` | account, preferences, expiry, CSRF token |
| POST | `/auth/revoke-all` | reauthenticate, revoke every session |

### Curriculum (read)
`GET /curriculum`, `GET /chapters/:id`, `GET /lessons/:id`, `GET /exercises/:id`.

`GET /exercises/:id` returns prompt, starter, runner cases and the saved draft.
It **omits solution and hint bodies** — those come only from the reveal
endpoint. Runner test cases are delivered to the browser and are inspectable;
they are not advertised as secret.

### Learning
| Method | Path | Behaviour |
| --- | --- | --- |
| POST | `/exercises/:id/reveals` | record a hint/solution reveal, return the content |
| POST | `/attempts` | submit answers or a bounded browser result |
| POST | `/lessons/:id/complete` | validate required exercises, record completion atomically |
| POST | `/lessons/:id/review-cards` | idempotently enrol the lesson's cards |
| POST | `/lessons/:id/skip` | record skipped; prior evidence and XP preserved |
| GET/POST | `/placements/:chapterId` | GET without answers; POST grades and records |
| GET | `/reviews/due` | due queue plus a server timestamp |
| POST | `/reviews/:cardId/responses` | revision-checked, schedules exactly once |
| GET | `/progress` | completion, evidence, assistance, placement, XP |
| GET | `/activity` | paginated server-ordered feed |

### Owner data
`GET/PUT /drafts/:exerciseId`, `GET /drafts/:exerciseId/snapshots`,
`GET/POST /notes`, `PATCH/DELETE /notes/:id`,
`GET /bookmarks`, `PUT/DELETE /bookmarks/:itemId`,
`GET /missions`, `GET /missions/:id`, `POST /missions/:id/reveals`,
`PUT /missions/:id/progress`,
`GET/PATCH /settings`, `GET /exports/progress`.

### Content operations
`POST /content/imports`, `GET /content/imports/:id`,
`POST /content/imports/:id/publish`, `GET /content/releases`,
`POST /content/releases/:id/activate`.

### Health
`GET /health/live`, `GET /health/ready` — minimal status, no secrets.

## Attempt submission

```json
{
  "clientEventId": "5c00bef3-3d09-421b-93e3-e6b1d0c052e0",
  "exerciseId": "js-arrays-filter-open",
  "exerciseVersionId": "…",
  "source": "function countOpen(tickets) { … }",
  "gradingOrigin": "browser_automated",
  "runnerResult": { "status": "passed", "passedCaseIds": ["empty", "mixed"], "durationMs": 18 }
}
```

The server derives `userId`, `assistance`, accepted case ids, XP and
timestamps. It does **not** trust submitted ownership, XP totals or mastery
state. It verifies that `exerciseVersionId` belongs to the stated exercise and
that reported case ids match that pinned definition, then stores the outcome as
client-reported `browser_automated` evidence. Learner source is never executed
on the server.

Server-graded submissions send `answer` instead of `runnerResult`.

## Conflicts

Writes to drafts, notes, mission progress, settings and review responses carry
`expectedRevision`. A mismatch returns 409 with the server's current value,
revision and timestamp so the client can preserve both versions. A stale DELETE
also conflicts, so a stale client cannot resurrect a deleted note.

There is no last-write-wins path anywhere in this API.
