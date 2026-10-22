# Home Brain dashboard

A small web dashboard for the Home Brain home server: is Chopper online, did last night's
backup succeed, how full the backup drive is, and other health checks.

Stack: Angular, Express / Node.js, PostgreSQL.

Built by AI agents (AP-5 leading Claude Code and Codex builders), reviewed and merged by Chris.
See `PLAN.md` for goals and milestones.

## Layout

- `api/`: Express API (Node.js), runs in Docker.
- `web/`: Angular app. For now it runs on the Angular dev server, not in a container.
- `docker-compose.yml`: the API plus PostgreSQL.

## Running locally

Requirements: Docker with Compose v2, and Node.js `^20.19.0 || ^22.12.0 || ^24.0.0` (the range Angular 21
supports) for the Angular app and for running the API tests locally.

### Shortcuts (repo root)

After the `.env` setup below and a one-time `npm install` in `web/`, from the repo root:

```sh
npm run backend    # docker compose up --build (API + Postgres)
npm run frontend   # Angular dev server (npm --prefix web start)
npm run all        # both at once; Ctrl-C stops both
```

On the Home Brain host, `npm run backend:homebrain` and `npm run all:homebrain` do the same with
the [Home Brain override](#home-brain-deployment) applied; the plain scripts stay portable.

`npm run all` runs `scripts/dev-all.sh`, a plain POSIX `sh` script, so the root `package.json` has
no dependencies (no `npm-run-all`/`concurrently`). It starts both in the background and, on Ctrl-C
or SIGTERM, sends SIGTERM to both and waits for them to exit (compose stops its containers;
`docker compose down` still removes them). npm doesn't reliably pass SIGTERM on to `ng serve`, so
the script signals the whole npm process tree (found with `pgrep -P`), which frees port 4200. Output from both is interleaved in one terminal. It
needs a Unix shell (Linux, macOS, WSL); on plain Windows use the two separate scripts.
`npm test` at the root checks these scripts (`scripts/dev-all.test.mjs`, stubbed `docker`/`npm`).

The sections below are the detailed, manual path.

### API + Postgres (Docker)

```sh
cp .env.example .env   # then set POSTGRES_PASSWORD to something real
docker compose up --build
```

This starts:

- `api`: the dashboard's dedicated port, `DASHBOARD_PORT` from `.env` (default **8090**), mapped
  to port 3000 inside the container.
- `postgres`: PostgreSQL 16. Only reachable from the compose network, not published to the host.
  Data lives in the `pgdata` volume.

Check the API is up:

```sh
curl -i http://localhost:8090/health
# HTTP/1.1 200 OK
# {"status":"ok","uptime":12.34}
```

Stop with `docker compose down` (add `-v` to also delete the Postgres volume).

### Reaching host-bound services

Inside a container, `127.0.0.1` refers to that container, not the host. A host
service listening only on `127.0.0.1` cannot accept connections addressed to
its Docker bridge gateway either: this is a TCP binding issue, not a firewall issue.

Compose maps `host.docker.internal` to `host-gateway` inside `api`, making the
host reachable by name. This requires Docker Engine 20.10+ on Linux; Docker
Desktop is not required. The mapping itself needs no host firewall change and
keeps the existing Compose network and Postgres connection in place.

The default bridge-network deployment requires host services to listen on an
address reachable through that mapping. For the Home Brain's loopback-only
Syncthing, use the override below; keep Syncthing bound to `127.0.0.1:8384`.

### Home Brain deployment

This Linux host uses an override because Syncthing's GUI/API intentionally listens
only on host loopback. The API uses host networking so it can reach that listener.
Requires Docker Compose **2.24.4+** (for the `!reset` merge tags).

Copy `.env.example` to `.env`, set real Postgres credentials and the Syncthing API
key, and use these host-specific values:

```sh
TEAM_STATUS_DIR=/srv/homebrain/hermes-dev/work/logs/status
SYNCTHING_URL=http://127.0.0.1:8384
DASHBOARD_PORT=8090
```

Run from the repository root:

```sh
npm run backend:homebrain   # foreground; add the Angular dev server with npm run all:homebrain
```

The manual equivalent (add `-d` to run it detached):

```sh
docker compose -f docker-compose.yml -f docker-compose.homebrain.yml up --build
```

The override sets `SYNCTHING_URL=http://127.0.0.1:8384` and publishes Postgres only
on `127.0.0.1:5434`, leaving port **5433** for the existing development database.
It builds the API's `DATABASE_URL` from `POSTGRES_USER`, `POSTGRES_PASSWORD`, and
`POSTGRES_DB`, using `127.0.0.1:5434` instead of Compose's `postgres` DNS name.
Port 5434 must be free before starting this deployment.

With host networking, there is no Docker port mapping: `DASHBOARD_PORT` sets the
app's `PORT` directly (default **8090**), and the health check uses that same port.
Choose the port the app should actually listen on; Docker cannot remap it.
The team status directory remains mounted read-only at `/logs/status`.

To check the merged configuration without starting containers:

```sh
docker compose -f docker-compose.yml -f docker-compose.homebrain.yml config
```

Use the same two `-f` arguments for subsequent `up`, `logs`, and `down` commands.

### Database (Prisma)

The schema lives in `api/prisma/schema.prisma` and migrations in `api/prisma/migrations/`. The
`api` container runs `prisma migrate deploy` on start, so `docker compose up` creates or updates
the tables.

To work on the schema outside Docker, point `DATABASE_URL` at a Postgres you can reach from the
host (export it, or put it in `api/.env`, which is gitignored), then:

```sh
cd api
npm install            # also runs `prisma generate`
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
per teammate, including a terminal instance until a newer one replaces it.
Active rows expose only work metadata (identity, role, engine, kind, issue/PR,
branch, phase, timestamps, and result); process IDs and host log paths are omitted.
Only a non-terminal latest instance marks a roster entry active. `recent`
contains the five newest terminal instances by `updated_at`, with
`name`, `title`, `issue`, `pr`, `phase`, `result`, and `updated_at`.

Missing directories return empty arrays; a missing roster returns an empty array.
Malformed or unreadable instance files are skipped. Unexpected directory or roster
read failures (including entries that are not objects with a non-empty string name)
return HTTP 503 with `{ "error": "Team status unavailable" }`.
The old `/api/status/builders` route is removed. Existing builder snapshots
remain in PostgreSQL but are no longer read or written by the API.

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
For the loopback-only listener, use the Home Brain host networking deployment.
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
npm install
npm start          # ng serve, http://localhost:4200
```

The frontend still has the legacy **Dev Builders** card, which calls the removed
`/api/status/builders` endpoint and will show an error until the separate frontend
migration switches it to the team API.

The **Syncthing** card fetches `GET /api/status/syncthing` every 30 seconds. It shows whether Syncthing is reachable (unknown if the check itself failed), how many
devices are connected, each configured folder's sync state, and the same kind of history strip.
Folder errors, out-of-sync items/bytes and check errors are shown as red text under the folder or
server row. The timeline helper both cards use lives in `web/src/app/shared/timeline.ts`.

The dev server proxies `/api` to the API at `http://localhost:8090` (`web/proxy.conf.json`), so
start the API with `docker compose up` first. If you changed `DASHBOARD_PORT`, change the proxy
target to match.

`npm run build` writes a production build to `web/dist/`.

#### Install scripts

npm 12 blocks dependency install scripts unless the package is listed in `allowScripts` in
`package.json`. `web/package.json` approves only the four packages the Angular toolchain needs:
`esbuild`, `lmdb`, `msgpackr-extract` and `@parcel/watcher`. If an `npm install` reports other
skipped scripts, review them before adding them (`npm install-scripts ls` lists them;
`npm install-scripts approve <pkg>` adds one). Don't use `approve --all`.
`node --test allow-scripts.test.mjs` (in `web/`) checks the list.

### Tests

```sh
cd api && npm install && npm test   # node:test: GET /health, snapshot store and team status unit tests
cd web && npm install && npm test   # Angular unit tests (Vitest): home page, Dev Builders card, timeline strip
```

The snapshot store's database tests (insert a row and read it back) are skipped unless
`DATABASE_URL` is set. To run them, migrate a database first:

```sh
cd api
export DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/DATABASE
npm run db:deploy && npm test
```

## Configuration

All config comes from environment variables. `.env.example` lists them; copy it to `.env`
(gitignored) and fill in real values. Never commit `.env` or any secrets.

## Branches

- `main`: released. Only Chris merges into it.
- `develop`: integration branch. Agent pull requests merge here after two reviews pass.
