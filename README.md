# DevPractice

A private, single-owner learning platform for practical web application
engineering: browser exercises, VS Code project missions, spaced review, and
progress that synchronises between laptop and phone.

No AI API credential is required. All lessons, hints, solutions and rubrics are
authored content, validated and published deliberately.

## Requirements

- Node.js 22 LTS (`.nvmrc`)
- pnpm 9
- Docker (for local PostgreSQL) or an existing PostgreSQL instance

## Setup

```bash
pnpm install
cp .env.example .env
docker compose up -d db          # PostgreSQL on port 5440
pnpm db:migrate
pnpm owner:bootstrap             # prompts for a password; never pass it as an argument
pnpm dev                         # web + api
```

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | run web and api together |
| `pnpm build` | build every workspace |
| `pnpm typecheck` / `pnpm lint` | static checks |
| `pnpm test` | all tests |
| `pnpm db:migrate` / `pnpm db:seed` | database lifecycle |
| `pnpm content:validate` | run every content gate |
| `pnpm content:build` | write a publishable snapshot package |
| `pnpm owner:reset-password` | reset the password and revoke all sessions |

## Layout

| Path | Contents |
| --- | --- |
| `apps/web` | React single-page app |
| `apps/api` | Fastify service (also serves the built frontend in production) |
| `packages/contracts` | schemas and DTOs shared by web, api and tooling |
| `packages/learning-core` | pure scheduling, evidence, XP and placement rules |
| `packages/runner` | bounded QuickJS-WASM execution, browser and Node |
| `packages/content-tools` | content validation and snapshot build CLI |
| `curriculum` | authored content and the concept catalog |
| `projects` | runnable learning repositories (missions M01–M08 in TypeScript, M09–M12 in .NET) |
| `docs` | architecture, operations, authoring and verification records |
| `handoff` | session handoff: current state, outstanding work, environment notes |

## Documentation

- [Codebase tour](docs/codebase-tour.md) — where things live, how a request flows
- [Learning algorithms](docs/learning-algorithms.md) — evidence, reviews, placement, XP
- [Content authoring](docs/content-authoring.md) — schema, gates, publishing
- [API contract](docs/api.md) · [Data model](docs/data-model.md)
- [Testing](docs/testing.md) · [Operations](docs/operations.md)
- [Known limitations](docs/known-limitations.md) — read before trusting a result
- [Implementation checklist](docs/implementation-checklist.md) · [Handoff](docs/handoff.md)

## What this is not

Browser results are client-reported and inspectable. Mission outcomes are
self-reported. The retention model is a transparent heuristic, not a measurement.
V1 is a foundation course (12 chapters); V2 adds production depth (20 chapters
total) and V3 adds .NET (30 chapters total). All three are published; the full
platform test suite has not been re-run since V2/V3 were published. See
[known limitations](docs/known-limitations.md).
