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

The API mounts `BUILDER_LOGS_DIR` (default `/opt/data/work/logs`) read-only at `/var/log/builders` (`LOGS`
inside the container). The host directory must already exist and be readable by
the container's `node` user. On other machines, set `BUILDER_LOGS_DIR` in `.env`
to an existing local logs directory before starting Compose. No GitHub credentials are mounted or passed in.

`api/src/builders.js` exports `readBuilderStatus(logsDir?)`, returning one
`{ name, status, lastLogLine }` entry for each builder discovered from `.pid` or `.log` filenames, plus idle
entries for `claude` and `codex` when absent. A
`<name>.pid` file means `running`; otherwise the builder is `idle`. The host
wrapper must remove PID files when jobs finish: stale files still mean running,
since host PIDs cannot be checked inside the container. Running builders get the
last line of `<name>.log` (or `null` for an empty/missing log); idle builders get
`null`. Reads are capped at the final 64 KiB; longer last lines return their
UTF-8 suffix. Other filesystem errors are surfaced to the caller. Local callers can
pass a logs directory explicitly or set `LOGS`. This module is ready for later
API polling/endpoint wiring; v1 deliberately omits GitHub PR/issue counts.

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
cd api && npm install && npm test   # node:test, hits GET /health on an ephemeral port
cd web && npm install && npm test   # Angular unit tests (Vitest)
```

## Configuration

All config comes from environment variables. `.env.example` lists them; copy it to `.env`
(gitignored) and fill in real values. Never commit `.env` or any secrets.

## Branches

- `main`: released. Only Chris merges into it.
- `develop`: integration branch. Agent pull requests merge here after two reviews pass.
