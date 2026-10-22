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


### Angular app (dev server)

```sh
cd web
npm install
npm start          # ng serve, http://localhost:4200
```

The default route shows a placeholder page. `npm run build` writes a production build to
`web/dist/`.

### Tests

```sh
cd api && npm install && npm test   # node:test: GET /health, snapshot store and builder status unit tests
cd web && npm install && npm test   # Angular unit tests (Vitest)
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
