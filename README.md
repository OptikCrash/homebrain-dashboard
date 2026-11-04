# Home Brain dashboard

A small web dashboard for the Home Brain home server: is Chopper online, did last night's
backup succeed, how full the backup drive is, and other health checks.

Stack: Angular, Express / Node.js, PostgreSQL.

Built by AI agents (AP-5 leading Claude Code and Codex builders), reviewed and merged by Chris.
See `PLAN.md` for goals and milestones.

## Layout

- `api/`: Express API (Node.js), runs in Docker.
- `web/`: Angular app. Production: built in Docker and served by nginx (`web/Dockerfile`,
  `web/nginx.conf`). The Angular dev server is an optional development workflow.
- `docker-compose.yml`: the whole deployment: web, API and PostgreSQL.

## Deployment (Docker Compose)

Requirements: Docker with Compose **2.30+** (synchronous startup hooks) and Linux host
networking (including the Home Brain's WSL mirrored setup). No host Node.js install is
needed: the images build the API and the Angular app themselves with `npm ci`.

```sh
cp .env.example .env
# Set POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB to the existing cluster credentials.
# Set status directories and the Syncthing API key as appropriate.
docker compose up -d
```

That one command builds the images (first run) and starts Postgres, the API (which applies
migrations) and the production web UI. Open <http://127.0.0.1:8080>.

Everyday commands:

```sh
docker compose up -d --build          # rebuild after pulling new code; data is kept
docker compose ps                     # state and health of web, api, postgres
docker compose logs -f web api postgres
docker compose stop                   # stop without removing anything
docker compose down                   # remove containers; keeps the pgdata volume
```

Never use `docker compose down -v` (or `--volumes`) on the deployment: it deletes `pgdata`.

Verify a running deployment:

```sh
curl -i http://127.0.0.1:8090/health                 # API directly: 200 {"status":"ok",...}
curl -i http://127.0.0.1:8080/healthz                # web server: 200 "dashboard-web ok"
curl -i http://127.0.0.1:8080/                       # production index.html
curl -i http://127.0.0.1:8080/api/status/couchdb     # API through the same-origin proxy
curl -i http://127.0.0.1:8080/api/does-not-exist     # API's own 404 JSON, not index.html
ss -ltn | grep -E ':(8080|8090|5434) '               # every listener is 127.0.0.1
```

Ports, all on host loopback and fixed in `docker-compose.yml`:

| Service | Address |
| --- | --- |
| Web UI (nginx, production build) | `http://127.0.0.1:8080` |
| API | `http://127.0.0.1:8090` |
| Dashboard Postgres | `127.0.0.1:5434` |
| Builders' devdb (outside this stack) | `127.0.0.1:5433` |

The web and API ports are separate: the browser only talks to 8080. nginx serves the
built Angular files and proxies `/api/*` to `127.0.0.1:8090` with path and query unchanged;
API status codes, bodies and content types pass through (a 404 or 503 from the API stays
that). Only UI routes fall back to `index.html`; a missing file (anything with an extension)
is a plain 404. `/healthz` is the web server's own readiness check. The web image holds
no `.env`, credentials or host `node_modules` (`web/.dockerignore`) and the service gets no
environment variables or mounts.

All-host networking is deliberate: on the Home Brain, WSL mirrored networking prevented
the host-network API from reaching Docker-published loopback Postgres ports. So nothing is
Docker-published: every service runs with `network_mode: host` and binds `127.0.0.1` itself
(Postgres `listen_addresses=127.0.0.1` on 5434, the API on 8090, nginx `listen 127.0.0.1:8080`),
with no `0.0.0.0` or IPv6 wildcard listener. Being on the host network, the web server reaches
the loopback-only API directly; a bridge network with a host-gateway entry could not. The API reaches
Syncthing at `127.0.0.1:8384` and CouchDB at `127.0.0.1:5984`. Keep those services
on loopback. CouchDB checks remain unauthenticated (200 and 401 both mean reachable);
only Syncthing needs its API key.

Plain `docker compose up -d` checks startup automatically. A port collision produces a
nonzero exit with an error naming the listener to free; inspect `docker compose logs`
for details. No unrelated listener is stopped or contacted as a database. Probes are
not race-proof: the actual server bind remains authoritative, and startup hooks fail
if the service cannot become ready. This covers all three ports: 5434 (Postgres), 8090
(API) and 8080 (web; nginx exits on "Address in use" and the container log says to free
127.0.0.1:8080). All containers retain `restart: unless-stopped`
for crash/reboot recovery. Synchronous startup hooks still return nonzero if readiness
fails, even during a restart loop. Repeated `up -d` leaves running containers alone;
`docker compose restart` checks ports again after stopping their old listeners.

Keep the existing Compose project name and `pgdata:/var/lib/postgresql/data` volume.
Do not rename the volume, change project names to migrate, reset data, or use `down -v`.
Existing initialized volumes keep their roles, passwords, migrations and status history.
`POSTGRES_*` initialization variables do not reset existing passwords. Supply the actual
existing credentials; authentication remains password-based without `trust` shortcuts.
Both fresh and initialized volumes use the image's `/etc/postgresql/dashboard-pg_hba.conf`,
selected explicitly by Compose's `-c hba_file=...`. It requires SCRAM-SHA-256 on TCP
loopback and leaves private Unix-socket bootstrap/administration available. The old
volume's HBA file is untouched and is no longer the effective configuration.
Fresh clusters also use `--auth-host=scram-sha-256`. Normal `up -d` after rebuilding
the image applies this policy to existing data; no manual HBA edit is needed.
Before readiness, startup verifies that TCP accepts the original configured password
and rejects an incorrect password specifically with a password-authentication failure.
Existing SCRAM verifiers work unchanged. MD5-only/absent verifiers or mismatched
credentials fail closed before API migrations. Use local Unix-socket administration
to review the role's verifier type and supply the legitimate existing credentials;
unsupported verifiers require an operator decision. Startup never resets a password,
converts a verifier, or falls back to weaker TCP authentication.
The API waits for this container's Postgres readiness before applying migrations.
Port 5434 is fixed together in the Postgres command, startup/auth checks, healthcheck
and API connection URL; changing just one is unsupported.

The startup check deliberately tries one random wrong password, so every Postgres start
logs one expected `FATAL: password authentication failed for user "..."` line. That line
alone is normal; the startup fails only when the dashboard's own error message follows.

The old `docker-compose.homebrain.yml` is now an empty compatibility override. Existing
two-file commands and `:homebrain` npm scripts still work, but no override is needed.
Host status mounts remain read-only. To validate without starting anything:

```sh
docker compose --env-file .env.example config
```

## Local development (optional)

Hot-reload development uses the Angular dev server on `http://localhost:4200` instead of the
production web container. It needs Node.js `^20.19.0 || ^22.12.0 || ^24.0.0` (the range
Angular 21 supports), also used for running the tests locally.

### Shortcuts (repo root)

After the `.env` setup above and a one-time `npm ci` in `web/`, from the repo root:

```sh
npm run backend    # docker compose up --build api postgres (no production web)
npm run frontend   # Angular dev server (npm --prefix web start)
npm run all        # both at once; Ctrl-C stops both
```

The dev scripts start only the `api` and `postgres` services, never the production `web`
service, so the dev server is the only UI. If the full deployment is already running, it
already serves the API; stop it first (`docker compose stop`) or skip `npm run backend`.
The `:homebrain` scripts remain compatibility aliases; host networking is the default.

`npm run all` runs `scripts/dev-all.sh`, a plain POSIX `sh` script, so the root `package.json` has
no dependencies (no `npm-run-all`/`concurrently`). It starts both in the background and, on Ctrl-C
or SIGTERM, sends SIGTERM to both and waits for them to exit (compose stops its containers;
`docker compose down` still removes them). npm doesn't reliably pass SIGTERM on to `ng serve`, so
the script signals the whole npm process tree (found with `pgrep -P`), which frees port 4200. Output from both is interleaved in one terminal. It
needs a Unix shell (Linux, macOS, WSL); on plain Windows use the two separate scripts.
`npm test` at the root checks these scripts (`scripts/dev-all.test.mjs`, stubbed `docker`/`npm`).

These use the same loopback API and Postgres settings. For direct API runs, `PORT` defaults
to 8090 and must be an integer from 1 to 65535. Compose fixes the API port to 8090. The old
`DASHBOARD_PORT` setting is retired; existing custom-port installations must update their
clients to 8090.

### Database (Prisma)

The schema lives in `api/prisma/schema.prisma` and migrations in `api/prisma/migrations/`. The
`api` container runs `prisma migrate deploy` on start, so `docker compose up` creates or updates
the tables.

To work on the schema outside Docker, point `DATABASE_URL` at a Postgres you can reach from the
host (export it, or put it in `api/.env`, which is gitignored), then:

```sh
cd api
npm ci                 # also runs `prisma generate`
npm run db:migrate     # prisma migrate dev: applies migrations, creates new ones after schema edits
```

The rest of the API reads and writes status history through `api/src/db/snapshots.js`
(`snapshots.record()`, `snapshots.latest()`, `snapshots.history()`).

### Dev team status

`GET /api/team/status` reads live files on each request and returns
`{ roster, active, recent }`, without polling or PostgreSQL history.
Compose mounts `TEAM_STATUS_DIR` (default `./logs/status`) read-only at `/logs/status`.
Set it to the host's `$LOGS/status`. Outside Docker, the reader uses
`TEAM_STATUS_DIR` directly, defaulting to `/logs/status`.

The directory contains the `roles.json` roster array and `<Name>-<N>.json`
instances described in PLAN.md. Roster entries retain their fields and add
`status: "idle"` or `"active"`. `active` contains the highest-numbered instance
per teammate only when its phase is non-terminal (`starting`, `building`,
`pushing`, or `reviewing`). Terminal instances appear only in `recent`.
Active rows expose only work metadata (identity, role, engine, kind, issue/PR,
branch, phase, timestamps, and result); process IDs and host log paths are omitted.
Only a non-terminal latest instance marks a roster entry active. `recent`
contains the five newest terminal instances by `updated_at`, with
`name`, `title`, `issue`, `pr`, `phase`, `result`, and `updated_at`.

### Host status files

The Home Brain host's root cron jobs write `backup.json`, `chopper.json`, and
`ap5.json` (schemas in PLAN.md) for the backup and bot health cards (M5, M6).
Compose mounts `HOST_STATUS_DIR` (default `/srv/homebrain/status`) read-only at
`/srv/homebrain/status`. Outside Docker, readers use `HOST_STATUS_DIR` directly,
defaulting to `/srv/homebrain/status`. No secrets live in this directory, so a
plain read-only bind mount is all it needs.

`api/src/checks/bots.js` reads `chopper.json` and `ap5.json`. `readAllBotHealth()`
returns one entry per bot: `{ bot, present: false }` when the file is missing or
can't be parsed, otherwise `{ bot, present: true, name, checked_at, container,
container_started_at, api, readiness, last_message_at, last_reply_at, stale }`.
Only those schema fields are copied; unexpected values become `null`, and
`readiness` is always `null` unless `api` is `up`. `stale` is true when
`checked_at` is missing or more than three minutes old (`isStale()`).

`GET /api/status/bots` reads both files on every request and returns
`{ "bots": [...] }` in Chopper, AP-5 order using the entries described above.
Missing or malformed files leave that bot unavailable (`present: false`) while
preserving the other bot's status. Unexpected read failures return HTTP 503 with
`{ "error": "Bot status unavailable" }`. This endpoint stores no PostgreSQL history.

Missing directories return empty arrays; a missing roster returns an empty array.
Malformed or unreadable instance files are skipped. Unexpected directory or roster
read failures (including entries that are not objects with a non-empty string name)
return HTTP 503 with `{ "error": "Team status unavailable" }`.
The old `/api/status/builders` route is removed. Existing builder snapshots
remain in PostgreSQL but are no longer read or written by the API.

### Backup status reader

`api/src/checks/backup.js` exports `readBackupStatus({ dir })`, defaulting to
`HOST_STATUS_DIR` or `/srv/homebrain/status`. It reads only `backup.json`, returning
`null` for a missing file/directory ("No backup yet"). Invalid JSON/fields throw
`Invalid backup status`; other read failures throw `Backup status unavailable`.
Readings retain the contract's snake_case fields, normalize absent fields to
`null`, and discard unknown fields. `previous` is a normalized completed run
only while running, otherwise `null`. Timestamps must include a timezone;
counts/byte sizes are nonnegative safe integers and duration may be fractional.

`isBackupStale(lastSuccess, now)` flags success timestamps strictly older than
26 hours (`now` defaults to epoch milliseconds; a Date also works). Missing or
invalid success timestamps return false, so consumers should handle "no successful
backup yet" separately. `isNewCompletedRun(reading, lastFinishedAt)` accepts
`ok`, `failed`, or `skipped` only, with a valid `finished_at` strictly newer than
the stored ISO timestamp or Date. A null/omitted stored timestamp means no saved
run; invalid stored timestamps return false. Running readings are never completed;
callers can check their `previous` explicitly to recover an intervening run.
The reader performs no polling, database writes, or Express routing.

### Backup polling and API

The API reads `backup.json` immediately on startup, then waits
`BACKUP_POLL_INTERVAL_MS` (default `30000`, positive integer up to `2147483647`)
after each completed poll. Polls never overlap and shutdown drains an active poll.
A completed `ok`, `failed`, or `skipped` run is stored only when its `finished_at`
is newer than the newest stored run. While running, `previous` is checked instead.
The `backup_run_snapshots` table retains normalized run details; a unique indexed
completion timestamp prevents duplicate rows across polls and restarts and supports
bounded newest-first queries. History is retained indefinitely.

`GET /api/status/backups` returns the following JSON shape for the backup card:

```json
{
  "current": {
    "state": "running",
    "started_at": "2026-10-23T03:00:00Z",
    "finished_at": null,
    "last_success": "2026-10-22T03:10:00Z",
    "error": null,
    "snapshot_id": null,
    "files_total": null,
    "bytes_total": null,
    "bytes_added": null,
    "duration_s": null,
    "previous": {
      "state": "ok",
      "started_at": null,
      "finished_at": "2026-10-22T03:10:00Z",
      "last_success": null,
      "error": null,
      "snapshot_id": "abc123",
      "files_total": null,
      "bytes_total": null,
      "bytes_added": 123456,
      "duration_s": null
    },
    "stale": false
  },
  "history": [
    {
      "state": "ok",
      "previous": null,
      "started_at": null,
      "finished_at": "2026-10-22T03:10:00.000Z",
      "last_success": null,
      "error": null,
      "snapshot_id": "abc123",
      "files_total": null,
      "bytes_total": null,
      "bytes_added": 123456,
      "duration_s": null
    }
  ]
}
```

`current` is the latest polled reader result plus `stale`, recalculated per request
using the reader's 26-hour rule. It is `null` before the first poll or when the
file does not exist. History contains up to ten completed runs, newest first,
and survives restarts or a missing file. History entries always
contain `previous: null`. Missing
metrics are `null`. Before any runs exist the response is
`{ "current": null, "history": [] }`. Requests do not trigger file reads.
Reader or storage failures return HTTP 503 with
`{ "error": "Backup status unavailable" }`; polling retries on the next interval.

### Syncthing health reader

`api/src/checks/syncthing.js` exports `readSyncthingStatus({ url, apiKey, folders, fetch })`.
Options default to `SYNCTHING_URL`, `SYNCTHING_API_KEY`, `SYNCTHING_FOLDERS` and
Node's built-in fetch. Folder IDs are comma-separated; an empty list checks only
the system and connections. Each request has a five-second timeout.

The reading contains `reachable`, `folders`, `connections` (device IDs mapped to
`{ connected }`), and `error`. Reachability means the system status request succeeded;
later failures preserve successful results and set `error`. Failed folder reads are
omitted, so consumers must check `error` before treating the reading as healthy.
Each folder includes `id`, `state`, `errors`, `needItems`, and `needBytes`.
Out-of-sync counts and folder errors are health signals, not request failures.
The reader performs no polling, database writes, or Express routing.

### CouchDB reachability reader

`api/src/checks/couchdb.js` exports `readCouchdbStatus({ url, fetch })`, defaulting
to `COUCHDB_URL` and Node's built-in fetch. It sends an unauthenticated GET to
`/_up`, falling back to `/` only for HTTP 404. HTTP 200 and 401 mean reachable;
other statuses, network errors and five-second request timeouts return
`{ reachable: false, error }`. Successful readings have `error: undefined`.
Base paths are preserved. URLs containing credentials, queries or fragments are
rejected, and redirects are disabled. No CouchDB credentials are needed.
For the loopback-only listener, use the default host networking deployment.
This reader performs no polling, database writes or Express routing.

### Syncthing status service

The API polls Syncthing immediately on startup, then waits
`SYNCTHING_POLL_INTERVAL_MS` (default `30000`, a positive integer) after each
completed poll. Polls never overlap; shutdown waits for active polls. Configure
`SYNCTHING_URL`, `SYNCTHING_API_KEY`, and `SYNCTHING_FOLDERS` in the environment
(passed through by Compose).

Each poll persists a `StatusSnapshot` under service `syncthing`. A reachable
reading with no request errors, folder errors, or outstanding items/bytes is
healthy; other readings are unhealthy. Unexpected check exceptions record
unknown with a safe error and polling retries on the next interval.

`GET /api/status/syncthing` returns `{ "current": null, "history": [] }` before
any polls. Afterwards, `current` is the newest snapshot and `history` contains
up to 100 snapshots, newest first, including `current`. Each snapshot includes
`status`, `recordedAt`, and the reader's folder, reachability, connection and
error details when available. Requests read persisted data without triggering a
check. Storage/read failures return HTTP 503 with
`{ "error": "Syncthing status unavailable" }`. History survives API restarts;
automatic retention is not implemented.

### CouchDB status service

The API polls CouchDB immediately on startup, then waits
`COUCHDB_POLL_INTERVAL_MS` (default `30000`, a positive integer) after each
completed poll. Polls never overlap; shutdown waits for active polls. Configure
`COUCHDB_URL` in the environment; Compose passes both settings through.

Each poll persists a `StatusSnapshot` under service `couchdb`. Reachable
readings (HTTP 200 or 401) are healthy; unreachable readings are unhealthy.
Unexpected check exceptions record unknown with a safe error and retry on
the next interval.

`GET /api/status/couchdb` reads persisted data without triggering a check.
It returns `{ "current": null, "history": [] }` before the first poll, then
the newest snapshot and up to 100 snapshots newest first, including current.
Snapshots contain `status`, `recordedAt`, and reachability/error details when
available. Storage/read failures return HTTP 503 with
`{ "error": "CouchDB status unavailable" }`. History survives API restarts;
automatic retention is not implemented.

### Angular app (dev server)

```sh
cd web
npm ci
npm start          # ng serve, http://localhost:4200
```

The frontend still has the legacy **Dev Builders** card, which calls the removed
`/api/status/builders` endpoint and will show an error until the separate frontend
migration switches it to the team API.

The **Syncthing** card fetches `GET /api/status/syncthing` every 30 seconds. It shows whether Syncthing is reachable (unknown if the check itself failed), how many
devices are connected, each configured folder's sync state, and the same kind of history strip.
Folder errors, out-of-sync items/bytes and check errors are shown as red text under the folder or
server row. The timeline helper both cards use lives in `web/src/app/shared/timeline.ts`.

The **LiveSync / CouchDB** card fetches `GET /api/status/couchdb` every 30 seconds. It shows
whether CouchDB is reachable (unknown if the check itself failed), any check error as red text, and
the same history strip. v1 is reachability only; replication detail waits on a read-only CouchDB user.

The **Backups** card fetches `GET /api/status/backups` every 30 seconds. It shows the current
run's state (`running`/`ok`/`failed`/`skipped`); while running, an indeterminate progress bar (no
percentage is reported) beside the previous run's outcome. A `last_success` over 26 hours old is
flagged "overdue" in amber. "No backup yet" shows when there's no `backup.json` and no history;
below that, up to ten recent completed runs (state, finish time in UTC, bytes added).

The **Bot health** card fetches `GET /api/status/bots` every 30 seconds. For Chopper and AP-5 it
shows container state, Hermes API up/down, readiness (`n/a` while the API is down), and the last
message/reply times in UTC — never message contents. A bot whose `checked_at` is more than three
minutes old is flagged "status stale"; a bot with no status file says so. Live state only, no history strip.

The dev server proxies `/api` to the API at `http://127.0.0.1:8090` (`web/proxy.conf.json`), so
start the API with `npm run backend` first. For a direct API run with a custom `PORT`, change the proxy target to match.

`npm run build` writes a production build to `web/dist/web/browser/`; the web image runs the same
build and serves that directory with nginx.

#### Install scripts

npm 12 blocks dependency install scripts unless the package is listed in `allowScripts` in
`package.json`. `web/package.json` approves only the four packages the Angular toolchain needs:
`esbuild`, `lmdb`, `msgpackr-extract` and `@parcel/watcher`. If an `npm install` reports other
skipped scripts, review them before adding them (`npm install-scripts ls` lists them;
`npm install-scripts approve <pkg>` adds one). Don't use `approve --all`.
`node --test allow-scripts.test.mjs` (in `web/`) checks the list.

### Tests

```sh
cd api && npm ci && npm test   # node:test: GET /health, snapshot store and team status unit tests
cd web && npm ci && npm test   # Angular unit tests (Vitest): home page, Dev Builders card, timeline strip
```

API networking tests also require Python 3 (included in CI and the Postgres image).
The CI-only `node scripts/network-smoke.mjs` uses an isolated disposable Compose project
to check free/occupied ports (8080, 8090, 5434), repeated startup, password auth and retained
history, the production web UI (HTML, hashed assets, UI-only SPA fallback, `/api` proxy with
API status/body/content type passthrough including 404/503) and loopback-only listeners, plus a
stock-initialized legacy-volume upgrade.
The upgrade first proves legacy TCP trust, then reuses that same disposable named volume
and compares cluster identity, roles/verifiers, migrations and seeded history after up/restart,
and re-checks the web UI. It uses loopback Syncthing/CouchDB fixtures and throwaway
credentials, so it proves the stack's wiring, not reachability of the real Home Brain services.
It refuses to start (stopping nothing) unless ports 8080, 8090, 5434, 8384 and 5984 are free.

The snapshot store's database tests (insert a row and read it back) are skipped unless
`DATABASE_URL` is set. To run them, migrate a database first:

```sh
cd api
export DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5434/DATABASE
npm run db:deploy && npm test
```

## Configuration

All config comes from environment variables. `.env.example` lists them; copy it to `.env`
(gitignored) and fill in real values. Never commit `.env` or any secrets.

## Branches

- `main`: released. Only Chris merges into it.
- `develop`: integration branch. Agent pull requests merge here after two reviews pass.
