# Home Brain Status Dashboard — PLAN

## Goal
A single dashboard showing whether Chopper, LiveSync (Obsidian LiveSync/CouchDB),
Syncthing, backups (restic), and the dev builder setup are healthy — current
status plus history over time (e.g. "Syncthing was down for 2h yesterday").

## Scope (v1)
- Angular front end, single page, auto-refreshing status cards per service.
- Express API that polls/reads each service's health on an interval and
  exposes current status + recent history.
- PostgreSQL stores status history (timestamped health snapshots per service)
  so the dashboard can show uptime/incident timelines, not just "now".
- No auth decided yet for v1 (LAN-only assumption); revisit before exposing
  outside the LAN.

## Stack details
- Single repo, Angular app and Express API as subfolders (as now).
- Dockerized: API + Postgres run in containers (Dockerfile + docker-compose).
- ORM: Prisma (Chris wants to try it; schema is simple enough that the
  learning curve is low-risk here).
- History/incident timelines: simple built-in rendering (colored timeline
  strip per service, no charting library) for v1. Revisit a charting lib
  (e.g. Chart.js) only if a later milestone needs real trend graphs
  (durations, counts over time) that a strip can't express.
- Network exposure: dashboard gets its own dedicated port, no reverse proxy.

## Health signals per service
- **Dev builder status**: read from this box — `$LOGS/*.pid` (running/idle)
  and `$LOGS/<name>.log` tail for what a running builder is doing, plus open
  PR/issue counts via `gh`. No external auth needed; same host.
- **Syncthing**: local REST API (`/rest/system/status`, `/rest/system/connections`,
  `/rest/db/status`) via API key. Healthy = reachable + no out-of-sync folders.
- **LiveSync / CouchDB**: CouchDB HTTP API (`/_up` or `/_active_tasks`) plus a
  check for stalled/failed replication. Healthy = CouchDB reachable and
  replication current.
- **Backups (restic)**: show a list of recent runs with outcome (success/fail)
  and timestamp, and a progress indicator if a backup is currently running.
  Source TBD — likely `restic snapshots --json` for history, and tailing the
  backup job's own log/wrapper script for in-progress state. Needs a look at
  however the restic job is actually invoked (cron? systemd timer?) before
  finalizing — flagged as open question below.
- **Chopper**: simple liveness check (process/session alive, last-activity
  timestamp). Exact signal TBD when we get to that milestone.

## Milestones

### M1 — Dashboard shell + dev builder status
Acceptance criteria:
- Angular app scaffolded, Express API scaffolded, Postgres schema for
  status history created and migrated.
- One working card: "Dev Builders" showing idle/running state per builder
  and, if running, the issue/PR it's working on and last log line.
- API endpoint returns current status + simple history (every poll stored).
- Runs locally via documented steps (README).

### M2 — Syncthing health
- Syncthing card: reachable/unreachable, folder sync state, errors surfaced.
- History recorded to Postgres; dashboard shows recent incidents.

### M3 — LiveSync / CouchDB health
- LiveSync card: CouchDB reachable, replication status (current vs. stalled).
- History recorded.

### M4 — Backups (restic)
- Backups card: recent run list with outcome + timestamp; in-progress
  indicator if a backup is running.
- Depends on confirming how the restic job runs/logs (open question).

### M5 — Chopper health
- Chopper card: simple liveness + last-activity timestamp.
- Exact signal confirmed with Chris before building.

## Decisions
- Dev builder status is the first check (data already available locally,
  lowest risk, good scaffold for the rest).
- History is in scope from v1 (not just live status) — backed by Postgres.
- Auth is explicitly deferred, not decided for v1.
- Stack: single repo, Dockerized API + Postgres, Prisma as ORM, no charting
  library for v1 (simple timeline strips instead), dashboard on its own
  dedicated port (no reverse proxy).

## Open questions
- Dev builder status (M1) reads host paths (`$LOGS/*.pid`, log tails) and
  shells out to `gh` for PR/issue counts. Since the API runs in a container,
  this needs a read-only bind mount of the logs dir into the container; `gh`
  calls should NOT ship the GitHub token into the dashboard container — PR/
  issue counts should either be dropped from M1's card or fetched via a
  narrowly-scoped read-only token kept out of the app image. Decide exact
  approach when scoping M1's issues.
- How exactly is the restic backup job invoked/logged (cron, systemd timer,
  wrapper script)? Needed to build M4 for real.
- Chopper's concrete health signal (process check? heartbeat file? something
  Chopper itself exposes?) — confirm before M5.
- Auth/exposure model if dashboard needs to be reachable off-LAN later.
