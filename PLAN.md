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
- **LiveSync / CouchDB**: CouchDB binds `127.0.0.1:5984` on the Home Brain —
  loopback-only, same as Syncthing, and also published externally via
  `tailscale serve` (don't touch that). The dashboard reaches it the same way
  it reaches Syncthing: `docker-compose.homebrain.yml`'s host networking.
  CouchDB requires auth for everything, including `/_up` (401 unauthenticated).
  v1 scope is reachability only, unauthenticated: a plain `GET /_up` (or `/`)
  is sent with no credentials; **200 or 401 both count as "reachable"**,
  anything else (connection error, timeout, other status) is unreachable. No
  admin credentials go in the dashboard. Replication-current detail needs a
  read-only CouchDB user Chris hasn't provisioned yet — deferred, see open
  questions.
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
  started). Only a non-terminal latest instance appears in Active work and marks the
  teammate active in the roster. Terminal instances appear only in Recent.
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
- LiveSync card: CouchDB reachable/unreachable (v1 scope — unauthenticated
  `GET /_up`, 200 or 401 both count as reachable; no admin credentials in the
  dashboard). Replication status is deferred to a later pass once a read-only
  CouchDB user exists.
- History recorded to Postgres; dashboard shows recent incidents.
- Reuses `docker-compose.homebrain.yml`'s host networking (same loopback
  situation as Syncthing) — no new compose work expected.

### M4.1 — Dashboard polish (Active work + history strips)
Feedback from Chris after M2–M4 landed. Acceptance criteria:
- **Active work card**: only shows jobs currently in a non-terminal phase
  (`starting`/`building`/`pushing`/`reviewing`). A teammate's finished
  (terminal-phase) instance no longer appears here — it only shows under
  "Recent", as already rendered. When nobody is active, the existing empty
  state ("Nobody is working on anything right now.") is what's shown.
  Root cause: `api/src/status/team.js`'s `active` list isn't filtered by
  phase; it needs the same `nonTerminal` filter already used for roster
  status.
- **History strips** (Syncthing + CouchDB cards): extract the duplicated
  strip markup into one shared component/template fed by `shared/timeline.ts`.
  - Strip is labeled, e.g. "History — last 24 hours".
  - `timelineSegments` takes a window (default 24h) and clips to it —
    segments older than the window are dropped, not just unlabeled.
  - Hover already shows a segment's status + start/end time (`title` attr);
    keep that, verify it reads clearly once segments are clipped.
  - A short legend under the strip: each status color in use, plus one line
    specific to that service's "red" (unreachable/unhealthy) meaning, e.g.
    "red = CouchDB didn't answer `GET /_up`" / "red = Syncthing unreachable
    or a folder out of sync".

## Host status files (M5, M6)
The Home Brain host now writes status files for the dashboard, refreshed by
root cron jobs. Mounted read-only into the API container at `/srv/homebrain/status`
(env var `HOST_STATUS_DIR`, same bind-mount pattern as `TEAM_STATUS_DIR`).
No secrets live in this directory. **The dashboard never gets Hermes API
keys, restic passwords, Docker socket access, or bot log files** — only
these JSON files.

- `backup.json` — written by the nightly restic job (root cron, daily 03:00
  local). May not exist until the first run.
  ```json
  {
    "state": "running | ok | failed | skipped",
    "started_at": "...", "finished_at": "... | null",
    "last_success": "...", "error": "... | null",
    "snapshot_id": "...", "files_total": 0, "bytes_total": 0,
    "bytes_added": 0, "duration_s": 0,
    "previous": { "state": "...", "finished_at": "...", "snapshot_id": "...", "bytes_added": 0 }
  }
  ```
  `skipped` = USB drive missing. `snapshot_id`/`files_total`/`bytes_total`/
  `bytes_added`/`duration_s` are present after a run. `previous` is present
  only while `state` is `running`.

- `chopper.json` and `ap5.json` — same schema, one per bot, refreshed every
  minute (root cron).
  ```json
  {
    "name": "...", "checked_at": "...",
    "container": "running | restarting | exited | missing",
    "container_started_at": "...",
    "api": "up | down", "readiness": "ok | degraded | ... | null",
    "last_message_at": "...", "last_reply_at": "..."
  }
  ```
  `api` is Hermes `/health`; `readiness` is Hermes `/health/detailed`'s
  status (`null` if `api` is down). `last_message_at`/`last_reply_at` are
  UTC timestamps only — message contents are never exposed, here or anywhere
  in the dashboard.

### M5 — Backups (restic)
Acceptance criteria:
- Backups card: current state (`running`/`ok`/`failed`/`skipped`), with a
  progress indicator while `running` (and that run's `previous` result shown
  alongside, e.g. "last run: ok, 2.1GB added").
- "No backup yet" shown if `backup.json` doesn't exist.
- Flag/highlight when `last_success` is older than ~26 hours (missed night).
- Recent-run history: each poll that observes a new completed run (a
  `finished_at` newer than the last one stored) is snapshotted to Postgres,
  so the card can show a short list of recent runs (state, timestamp,
  bytes added) — `backup.json` itself only ever holds the current/previous
  run, not a log.
- Reads `backup.json` from `HOST_STATUS_DIR`; no restic credentials or
  commands anywhere near the dashboard.

### M6 — Bot health (Chopper + AP-5)
Acceptance criteria:
- One card (or one per bot, same component) showing both `chopper.json` and
  `ap5.json`: container state, API up/down, readiness, last message/reply
  times (UTC, times only).
- `checked_at` older than ~3 minutes is shown as "status stale" rather than
  trusted as current.
- Live state only, like the Team roster/Active work cards — no Postgres
  history for this card (matches the original M1/M2 reasoning: the status
  files are themselves the source of truth).
- Reads `chopper.json`/`ap5.json` from `HOST_STATUS_DIR`; never surfaces
  message contents, log files, or requires Hermes API keys.

### M7 — AGENTS.md (builder rulebook)
A one-page `AGENTS.md` at repo root: project map, commands, conventions,
Home Brain gotchas, security rules. Plus a one-line `CLAUDE.md` pointing at
it, so both builder engines read the same rules. See issue for the exact
required content.

## Decisions
- `package-lock.json` is committed (root, `web/`, and `api/`) and Docker
  builds use `npm ci`, not `npm install` — reproducible builds. A PR that
  changes a lockfile without a corresponding `package.json` change should be
  flagged in review as unexpected/unintended.
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
- LiveSync/CouchDB replication-current detail (M4) needs a read-only CouchDB
  user; Chris hasn't provisioned one yet. v1 ships reachability only; revisit
  once that user exists.
- Auth/exposure model if dashboard needs to be reachable off-LAN later.
