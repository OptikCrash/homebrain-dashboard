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
- **Dev team status**: read from this box — the team's roster and live work
  state, written by the `dev-*` tooling itself (see "Dev team status file
  format" below). Replaces the earlier `$LOGS/*.pid`/log-tail approach from
  M1, which showed every past job as a permanent row with a meaningless
  always-full progress bar.
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

## Dev team status file format
Written by the `dev-*` tooling on the Home Brain host, read by the API over a
read-only bind mount of `$LOGS/status`. Two kinds of file:

- `roles.json` — the static roster (who exists on the team), one array:
  ```json
  [{"name": "Sabine", "title": "frontend", "engine": "claude",
    "summary": "Angular front end - components, styling, accessibility, front-end tests."}]
  ```
  `engine` is `claude`, `codex`, or `auto` (reviewers, who run on whichever
  family didn't write the code).

- `<Name>-<N>.json` — one file per *instance* of a teammate's work (a fresh
  instance number each time that teammate starts a new job, e.g. `Sabine-1.json`,
  `Sabine-2.json`). Written/updated atomically as the job progresses:
  ```json
  {
    "instance": "issue-6-sabine", "name": "Sabine", "title": "frontend",
    "engine": "claude", "kind": "build", "issue": 6, "pr": 13,
    "branch": "issue-6-sabine", "phase": "pushing",
    "started_at": "2026-10-22T18:00:00Z", "updated_at": "2026-10-22T18:04:00Z",
    "result": "", "pid": 1234, "log": "/opt/data/work/logs/issue-6-sabine.log"
  }
  ```
  `phase` is one of: `starting`, `building`, `pushing`, `reviewing` (all
  non-terminal/active), or `done`, `failed`, `no-changes`, `stopped`
  (terminal). `kind` is `build` or `review`. `issue`/`pr` may be null.

- **Dashboard rule**: for "who's working on what", use only the
  *highest-numbered instance file per teammate name* (the latest job they
  started). A terminal-phase instance stays visible as that teammate's row
  until a new instance file for the same name appears (at which point the
  new one replaces it) — so a just-finished job doesn't vanish immediately,
  but nothing piles up as permanent history either.
- No Postgres history/timeline for this card — it's live state, not an
  uptime trend; the roster + instance files are themselves the source of
  truth and need no snapshot store.
- Progress for an active row is a **phase stepper** (starting → building →
  pushing → reviewing), not a continuous/always-full bar.

## Milestones

### M1 — Dashboard shell + dev builder status ✅ done
Acceptance criteria:
- Angular app scaffolded, Express API scaffolded, Postgres schema for
  status history created and migrated.
- One working card: "Dev Builders" showing idle/running state per builder
  and, if running, the issue/PR it's working on and last log line.
- API endpoint returns current status + simple history (every poll stored).
- Runs locally via documented steps (README).
- Superseded by M2: the pid/log-based approach is being replaced by the
  roles.json/status-file approach below.

### M2 — Team roster + Active work dashboard
Acceptance criteria:
- "Team roster" card: every teammate from `roles.json`, idle or active.
- "Active work" card: who's on what issue/PR, current phase (as a stepper,
  not a continuous bar), and how long they've been on it — built from the
  dev team status files described above, with the "latest instance per
  teammate" selection/retention rule.
- Replaces the old `$LOGS/*.pid`-based dev-builders check/status/card and
  its Postgres snapshot history (no longer needed for this card).
- `web/package.json` `allowScripts` includes `esbuild`, `lmdb`,
  `msgpackr-extract`, `@parcel/watcher` (npm-flagged postinstall scripts).

### M3 — Syncthing health
- Syncthing card: reachable/unreachable, folder sync state, errors surfaced.
- History recorded to Postgres; dashboard shows recent incidents.

### M4 — LiveSync / CouchDB health
- LiveSync card: CouchDB reachable, replication status (current vs. stalled).
- History recorded.

### M5 — Backups (restic)
- Backups card: recent run list with outcome + timestamp; in-progress
  indicator if a backup is running.
- Depends on confirming how the restic job runs/logs (open question).

### M6 — Chopper health
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
  narrowly-scoped read-only token kept out of the app image.
  **v1 (#4):** counts dropped; bind mount via `BUILDER_LOGS_DIR`, no token in
  the container. The issue/PR a job is for comes from its file name.
- Builder log lines are exposed as-is (only truncated) and the API has no auth
  yet. If logs can contain anything sensitive, redact or drop them before the
  dashboard is reachable beyond the LAN.
- How exactly is the restic backup job invoked/logged (cron, systemd timer,
  wrapper script)? Needed to build M4 for real.
- Chopper's concrete health signal (process check? heartbeat file? something
  Chopper itself exposes?) — confirm before M5.
- Auth/exposure model if dashboard needs to be reachable off-LAN later.
