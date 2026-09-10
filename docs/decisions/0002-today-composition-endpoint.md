# 0002 — GET /today is a composition endpoint

Status: accepted
Date: 2026-09-09

## Context

Spec section 9.2 lists the endpoint inventory and does not include `/today`.
Spec section 4.2 nevertheless requires a Today screen showing resume activity,
due reviews, the active mission, recent activity and XP, and section 9.4
requires polling Today every 30 seconds while the tab is visible.

The web client was written against a `GET /today` that no client-visible
requirement had put on the server. It 404'd on every load of the home screen.

## Decision

Implement `GET /api/v1/today` as a read-only, owner-scoped COMPOSITION endpoint
in its own module (`apps/api/src/modules/today/`).

It introduces no new source of truth. Every field is derived from the same
records the dedicated routes already expose:

| Field            | Derived from                                        |
|------------------|-----------------------------------------------------|
| `resume`         | most recent `LessonProgress` with status in_progress |
| `reviewsDue`     | `ReviewState` where `dueAt <= now`                   |
| `activeMission`  | most recent `MissionProgress` with status in_progress|
| `recentActivity` | `ActivityEvent`, newest first, 10 rows               |
| `totalXp`/`level`| sum of `XpAward.amount`; `levelForXp`                |

## Rationale

The alternative was five separate client requests composed in the browser.
Because Today is polled every 30 seconds while visible, that multiplies the
request rate on the screen the owner leaves open most, for no benefit. A
skipped lesson is a decision rather than unfinished work, so it never resumes.
Content that has left the active release degrades to `null` rather than
returning 404 on the owner's home page.

## Consequences

This is a documented departure from the section 9.2 inventory, permitted by
section 1.1 (ordinary implementation decisions are the implementer's, with
material departures recorded in an ADR). The endpoint is additive: no route in
the inventory changed shape or behaviour.
