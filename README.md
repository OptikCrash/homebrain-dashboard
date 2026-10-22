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

**Chris must also change Syncthing on the host.** In Syncthing's `config.xml`,
change the GUI/API listen-address line from:

```xml
<gui address="127.0.0.1:8384" ...>
```

to:

```xml
<gui address="0.0.0.0:8384" ...>
```

The `...` represents the existing attributes; preserve those and the GUI's
contents. Restart Syncthing after editing. Alternatively, bind to the specific
Docker bridge gateway IP for this Compose project, provided it is reachable
through the configured host mapping. To inspect the address the API uses:

```sh
docker compose exec api getent hosts host.docker.internal
```

If that address differs from the project's bridge gateway, use the reachable
gateway IP explicitly in `SYNCTHING_URL` when binding only to that interface.
Binding to `0.0.0.0` listens on all host interfaces. If LAN access to port 8384
is unwanted, configure the host firewall to block LAN access while allowing
the API container to connect. Syncthing's API key provides another layer of
protection; set `SYNCTHING_API_KEY` from its GUI settings.

After the host change, use `SYNCTHING_URL=http://host.docker.internal:8384`
(the default in `.env.example` and Compose) and recreate `api` to apply the
configuration (`docker compose up -d api`). Host config edits, Syncthing restarts,
and firewall changes must be performed on the real host, outside a builder sandbox.
The same binding requirement applies to LiveSync/CouchDB if its host service
also listens only on loopback; use its own reachable listen address and port.

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

### Dev builder status

`api/src/checks/builders.js` (`readBuilderStatus()`) reports the dev builders' state from the
builder host's logs dir, which compose mounts read-only at `/logs` in the `api` container. Set
`BUILDER_LOGS_DIR` in `.env` to that host dir; it defaults to `./logs` (gitignored) so compose
starts on any machine.

Jobs are discovered from `<job>.pid` files. A job with a matching `<job>.done` is idle; otherwise
it's running, and the check returns the last non-blank line of `<job>.log` (tail only, truncated)
and flags it `stale` if neither file has changed for 2 hours. The job name gives the target:
`issue-4-codex` is the codex builder on issue #4, `review-10` is a review of PR #10. Other files
(e.g. `wake.log`) are ignored.

No GitHub token goes into the container, so open PR/issue counts aren't shown in v1.

The API polls immediately on startup, then every `BUILDER_POLL_INTERVAL_MS` milliseconds
(default `30000`, a positive integer). Slow polls finish before the next interval starts.
Each poll writes one `StatusSnapshot` per discovered builder, using service keys such as
`dev-builders:codex`. Idle and active builders are healthy; stale jobs are unhealthy.
Jobs without a named builder use their job name as the identity (for example,
`dev-builders:review-10`), preserving review PR targets and history.
Previously seen builders missing from the logs, or an unreadable logs directory, produce
unknown snapshots. Poll errors are logged and retried; shutdown waits for the active poll.

`GET /api/status/builders` reads persisted snapshots and returns:

```json
{
  "builders": [{
    "name": "codex",
    "current": {
      "name": "codex",
      "status": "healthy",
      "state": "idle",
      "available": true,
      "jobs": [],
      "recordedAt": "2026-10-22T12:00:00.000Z"
    },
    "history": [{
      "name": "codex",
      "status": "healthy",
      "state": "idle",
      "available": true,
      "jobs": [],
      "recordedAt": "2026-10-22T12:00:00.000Z"
    }]
  }]
}
```

`history` contains the most recent 100 snapshots per builder, newest first, including
`current` as its first entry. Each entry has the same shape as `current`; `jobs` contains
that builder's reader job details (target, state, and activity/log details when running).
An unavailable read also includes `error`. Builders are sorted by name. Before any builder
has been discovered, the response is `{"builders":[]}`. Database failures return HTTP 503
with `{"error":"Builder status unavailable"}`. The endpoint does not trigger a poll.
Snapshots remain in Postgres across API restarts; automatic retention is not implemented.
Service discovery groups names in Postgres, so polling and status requests transfer only
one name per builder rather than fetching duplicate names from the full snapshot history.


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

### Angular app (dev server)

```sh
cd web
npm install
npm start          # ng serve, http://localhost:4200
```

The default route shows the dashboard with the **Dev Builders** card. The card fetches
`GET /api/status/builders` on load and then every 30 seconds, and shows each builder's state
(idle/running/unknown, colored by health), the issue/PR and last log line of any running job, and
a timeline strip of its recent history (green healthy, red unhealthy, grey unknown; hover a
segment for its time range). If a refresh fails it keeps the last data and shows an error.

Next to it, the **Syncthing** card fetches `GET /api/status/syncthing` on the same 30-second
cycle. It shows whether Syncthing is reachable (unknown if the check itself failed), how many
devices are connected, each configured folder's sync state, and the same kind of history strip.
Folder errors, out-of-sync items/bytes and check errors are shown as red text under the folder or
server row. The timeline helper both cards use lives in `web/src/app/shared/timeline.ts`.

The dev server proxies `/api` to the API at `http://localhost:8090` (`web/proxy.conf.json`), so
start the API with `docker compose up` first. If you changed `DASHBOARD_PORT`, change the proxy
target to match.

To watch it update, create a dummy job in the logs dir (`./logs` by default) and wait for a poll:

```sh
echo 1 > logs/issue-99-test.pid; echo "doing things" > logs/issue-99-test.log   # running
touch logs/issue-99-test.done                                                     # idle
```

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
cd api && npm install && npm test   # node:test: GET /health, snapshot store and builder status unit tests
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
