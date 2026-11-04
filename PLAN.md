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
  From M10, the production Angular build runs in Compose too (see M10); the
  Angular dev server stays an optional, non-containerized dev workflow.
- ORM: Prisma (Chris wants to try it; schema is simple enough that the
  learning curve is low-risk here).
- History/incident timelines: simple built-in rendering (colored timeline
  strip per service, no charting library) for v1. Revisit a charting lib
  (e.g. Chart.js) only if a later milestone needs real trend graphs
  (durations, counts over time) that a strip can't express.
- Network exposure: dashboard gets its own dedicated port, no reverse proxy.
  From M10 the shipped deployment is loopback-only: web on `127.0.0.1:8080`,
  API on `127.0.0.1:8090`. The web server's same-origin `/api` proxy to the
  API is part of the dashboard itself, not a separate reverse proxy in front
  of it.

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

### M7 — AGENTS.md (builder rulebook) ✅ done
A one-page `AGENTS.md` at repo root: project map, commands, conventions,
Home Brain gotchas, security rules. Plus a one-line `CLAUDE.md` pointing at
it, so both builder engines read the same rules.

### M8 — CI (GitHub Actions)
A single required `ci` check on every PR and on push to `develop`:
checkout, install (`npm ci` at root/`api`/`web`), root `npm test`, api tests
against a real `postgres:16` service container, web tests (headless +
`allow-scripts.test.mjs`), web build. `AGENTS.md` gets a line: a PR isn't
done until `ci` is green.

### M9 — Team skills (`.claude/skills/`)
Four `SKILL.md` files, each distilled from patterns already merged (not
invented process): `add-dashboard-card` (Sabine), `add-status-endpoint`
(Zeb), `prisma-migration` (Zeb), `review-checklist` (Hera, built by Ezra).
`AGENTS.md` gets a "Skills" section listing them so Codex builders read them
too.

### M10 — Loopback-only full Compose deployment
Goal: after documented `.env` setup, plain `docker compose up -d` builds and
starts the whole dashboard (Postgres, API, production web) on the Home Brain,
and nothing in the shipped deployment listens beyond host loopback.

**Implementation dependency:** this PLAN entry lands first, on its own. The
Postgres networking decision is settled (Chris approved host-network Postgres
and web, see "Decision — Postgres and web networking" below), and Chris has
authorized implementation once this addendum merges. Runtime work is #89;
#90 stays dependent on #89.

Acceptance criteria:
- **API (default `docker-compose.yml`)**: `network_mode: host`, `PORT` 8090,
  and an explicit `127.0.0.1` bind in `api/src/server.js` (today it calls
  `listen(port)` with no host, i.e. all interfaces). The API's `ports`,
  bridge DNS (`postgres` host name) and `extra_hosts` entries are removed as
  incompatible with host networking. `DATABASE_URL` uses `127.0.0.1` and a
  Postgres host port that is neither 5432 nor 5433 (5433 is the builders' dev
  database). `SYNCTHING_URL` / `COUCHDB_URL` default to `http://127.0.0.1:8384`
  / `http://127.0.0.1:5984`.
- **No wildcard listeners**: no `0.0.0.0`, `::` or unqualified port listener
  or publication anywhere in the shipped dashboard deployment (API, web,
  Postgres).
- **Postgres (default `docker-compose.yml`)**: `network_mode: host`, no
  `ports`, and the explicit command
  `["postgres", "-p", "5434", "-c", "listen_addresses=127.0.0.1"]`, so it
  listens on `127.0.0.1:5434` only (the approach already proven in the Home
  Brain override). The healthcheck targets `-h 127.0.0.1 -p 5434`. Preserved:
  - **Password auth**: credentials from `.env` (`POSTGRES_*`, required) and
    password authentication stay as today; moving to host networking must not
    switch to `trust` or any other password-less method.
  - **Existing data**: the same `pgdata` volume — same volume name and Compose
    project, so the existing data directory (cluster identity, migration
    history and recorded status history) is reused as-is, not re-initialized,
    renamed or replaced.
  - **Existing volume authentication**: an already-initialized `pgdata`
    keeps its existing roles and passwords. No `pg_hba.conf` shortcuts (no
    added `trust` lines, no loosened auth methods) and no silent credential
    resets (no init scripts or `ALTER ROLE` run to make `.env` match). The
    `POSTGRES_*` initialization env vars only apply when the data directory is
    first created; they do not retroactively change passwords in an existing
    volume, so `.env` must keep the credentials that volume was created with.
  - Migrations applied on API start (`prisma migrate deploy`), the read-only
    status mounts, and the API waiting on Postgres readiness
    (`service_healthy`).
- **Startup safeguards (plain `docker compose up -d`)**:
  - **Occupied port fails automatically**: if 5434, 8090 or 8080 is already
    held by something other than this stack, the plain Compose startup path
    exits non-zero with a clear, actionable message naming the port and what
    to do (free it or stop the other listener). A service that merely ends up
    unhealthy while `up` reports success does not meet this. It never
    silently falls back to another port, another address or a wildcard bind,
    and no manual pre-check or extra script is required.
  - **Never touch the other listener**: the stack must not stop, kill or
    reconfigure an unrelated service holding a port, must not connect the API
    to a database it did not start (a stranger's Postgres on 5434), and must
    never run migrations against one.
  - **Startup race / bind failure**: a preflight port probe, if used, is not
    race-proof (another process can take the port between check and bind), so
    it cannot be the only safeguard. The real bind is authoritative: a bind
    failure at service start (e.g. `EADDRINUSE`, Postgres "could not bind")
    must be detected and surface as the same clear non-zero failure, not a
    restart loop that looks healthy or an API talking to the wrong listener.
  - **Idempotent repeated up**: running `docker compose up -d` again, or a
    container restart, while the dashboard is already up succeeds and leaves
    the running stack (and its data) as is — its own listeners never count
    as "occupied".
- **Web image**: multi-stage Dockerfile for `web/` — build stage runs `npm ci`
  against the committed `web/package-lock.json` and the production Angular
  build; the serving stage is a small static server with no dev server and no
  Node build toolchain at runtime.
- **Web in Compose**: a `web` service in the default `docker-compose.yml`,
  endpoint `http://127.0.0.1:8080`. Host networking is mandatory:
  `network_mode: host`, no `ports`, and the server itself listens on
  `127.0.0.1:8080` via an explicit listen directive. A `127.0.0.1:` port
  publication over a wildcard in-container listener does not count. Being on
  the host network, it reaches the loopback-only API without an exposed
  gateway.
- **Same-origin `/api`**: the web server proxies `/api/*` to
  `127.0.0.1:8090` with paths unchanged, and passes API status codes and
  bodies through (a 404/500/503 from the API stays that, not the SPA's
  `index.html`). SPA fallback to `index.html` applies only to UI routes.
- **npm scripts**: `npm run backend[:homebrain]` and `npm run all[:homebrain]`
  (`scripts/dev-all.sh`) currently run every Compose service next to the
  Angular dev server. Scope them to `api` + `postgres` so dev workflows don't
  also start the production `web` service; update `scripts/dev-all.test.mjs`.
- **Docs**: README and `.env.example` describe the production deployment: a
  port list (8080 web, 8090 API, 5434 Postgres, 5433 reserved for the
  builders' dev database), all on `127.0.0.1`; the WSL mirrored networking
  rationale for host networking (a host-network container can't reach a
  Docker-published `127.0.0.1` port there, so every service runs on the host
  network); what happens when a port is occupied; loopback URLs; and
  rebuild / start / stop / verify steps, with the Angular
  dev server documented separately as an optional dev workflow. The
  implementation builder updates `AGENTS.md` where its commands, layout or
  gotchas go stale (e.g. "Angular dev server, not containerized", the
  override-only host networking notes).
- **Tests and CI**: regression tests for the listen addresses and the Compose
  listener/exposure configuration (no wildcard binds, expected ports), plus a
  Docker-enabled CI smoke path that builds both images, starts the stack,
  confirms migrations ran, and checks: API `/health`; served production HTML
  and assets on the web endpoint; same-origin `/api` proxying; an API non-200
  response passed through unchanged. Startup safeguard tests, run by the
  builder and in CI: a free-port case (stack starts, repeated `up -d`
  succeeds) and an occupied-port case for each of 5434, 8090 and 8080 (a
  stand-in listener holds the port; `up` exits non-zero with the clear
  message, the stand-in is left running and untouched, and no migration runs
  against it). Syncthing/CouchDB use isolated,
  credential-free loopback fixtures in CI. Live Syncthing access is not
  claimed as verified without real, authorized evidence from the host.
- **Unchanged guardrails**: the required `ci` check (job id `ci`, no `name:`,
  `contents: read`, no secrets, never `pull_request_target`) and both reviews
  stay; no secrets and no Docker socket in any application container.

**Decision — Postgres and web networking (approved by Chris).** Postgres and
web both run with `network_mode: host` in the default `docker-compose.yml`,
alongside the host-network API; nothing is Docker-published. Why: the README,
`AGENTS.md` and `docker-compose.homebrain.yml` record that on the Home Brain,
WSL mirrored networking stops a host-network container from reaching a
Docker-published `127.0.0.1` port, so a bridge publication such as
`127.0.0.1:5434:5432` is not used. Postgres runs the explicit command above
(`-p 5434 -c listen_addresses=127.0.0.1`), web listens on `127.0.0.1:8080`
and the API on `127.0.0.1:8090`.

Plain `docker compose up -d` is sufficient on its own — no extra override
file is required — and the WSL rationale stays documented, not dropped or
contradicted. `docker-compose.homebrain.yml` is removed, or reduced to
whatever is still host-specific, as part of the implementation.

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
- M10 (planned): the shipped deployment binds loopback only (web
  `127.0.0.1:8080`, API `127.0.0.1:8090`, Postgres `127.0.0.1:5434`, all
  three on host networking, approved by Chris) and starts from the default
  `docker-compose.yml` alone, failing on an occupied port. This narrows
  the v1 "LAN-only" assumption to host-only; off-host access stays an open
  question below.

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
