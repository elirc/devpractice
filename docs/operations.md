# Operations

## Environments

| Environment | Shape |
| --- | --- |
| Local | web + api + disposable PostgreSQL (Docker, port 5440) |
| Test | separate database, migrations applied per run |
| Production | one containerised Node service + PostgreSQL, HTTPS, persistent storage, daily backups |

The frontend and `/api` are served from **one origin**. That keeps cookies
host-only, avoids credentialed cross-origin requests, and removes a whole class
of CORS and CSRF complexity.

Learning-project databases (M02, M03) are **separate** from the platform
database and run on their own ports (5441, 5442).

## Configuration contract

| Variable | Meaning |
| --- | --- |
| `NODE_ENV` | `development` / `production` |
| `PORT` | HTTP port |
| `APP_ORIGIN` | canonical origin; used for Origin validation |
| `DATABASE_URL` | platform PostgreSQL |
| `TEST_DATABASE_URL` | disposable test database |
| `AUTH_COOKIE_NAME` | session cookie name (`__Host-` prefixed in production) |
| `SESSION_ABSOLUTE_DAYS` / `SESSION_IDLE_DAYS` | 30 / 7 |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_MINUTES` | 5 / 15 |
| `IMPORT_MAX_BYTES` | 10 MiB |
| `RUNNER_TIMEOUT_MS`, `RUNNER_MAX_SOURCE_BYTES` | runner limits |
| `LOG_LEVEL` | `info` by default |

Only genuinely public values reach the frontend bundle. Database URLs, password
material, CSRF secrets and session tokens never do. The owner bootstrap command
is an **administrative CLI**, never an unauthenticated production endpoint.

## Logging

Structured request logs carry `requestId`, route, status, duration and a
non-sensitive owner reference.

Never logged: passwords, cookies, CSRF tokens, note bodies, learner source, full
request payloads. Import failures log item ids and validation paths — never the
uploaded package.

## Backups and recovery

- Daily PostgreSQL backups, at least 7 daily retained, stored **outside** the
  application container.
- Content release assets are preserved with matching checksums so starter
  downloads keep working after a restore.
- Initial objectives: at most 24 hours of data loss, restore achievable within
  4 hours. These are **targets to be tested**, not an SLA.

### Restore runbook

1. Provision a clean PostgreSQL instance.
2. Restore the most recent verified backup.
3. Restore content release assets; verify checksums match.
4. Run migration compatibility checks against the restored schema.
5. Configure secrets (never restore them from the backup).
6. Start the service; verify `/health/ready`.
7. Verify owner login and that the expected active release resolves.
8. Compare record counts against the backup manifest: users, attempts,
   lesson progress, review states, notes, XP awards.

The JSON progress export is a **portability** feature. It is not a substitute
for a consistent database backup, and it must not be described as one.

## Release procedure

1. Format, lint, typecheck.
2. Business-rule tests, API integration tests, representative e2e checks.
3. `pnpm content:validate -- --target v1`.
4. Production build; build a versioned container.
5. **Back up production** before applying migrations.
6. Apply migrations. Prefer additive changes; make removals a separate later
   step. Never automatically drop learner history.
7. Start the new service; verify readiness and the principal learning flow.
8. Monitor errors.
9. Record: application commit, migration version, content release id, rollback
   instructions.

### Rollback

Roll back **application code** only when its database compatibility is known —
that is what additive migrations buy you.

Restoring a database backup is a **distinct recovery action with possible data
loss**. It is not an ordinary rollback and must never be described as one
without stating the consequence.

## Maintenance

`pnpm --filter @devpractice/api maintenance:prune` removes expired sessions and
mutation receipts older than 30 days. Durable unique event ids in the underlying
tables continue to prevent duplicates after receipts are pruned.

Draft snapshots are capped at 20 per exercise as they are written.
