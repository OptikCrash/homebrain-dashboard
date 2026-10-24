# AGENTS.md — builder rulebook

Read this before working. Then read `PLAN.md` and `README.md`.

## Project map

- `api/` — Express + Prisma backend (runs in Docker). Schema and migrations in `api/prisma/`.
  Tests: `api/test/*.test.js` (`node:test`).
- `web/` — Angular frontend (Angular dev server, not containerized). Tests: `web/src/**/*.spec.ts`
  (Vitest via `ng test`), plus `web/allow-scripts.test.mjs`.
- `scripts/dev-all.sh` — backs `npm run all`; tested by `scripts/dev-all.test.mjs`.
- Status-file contracts: see PLAN.md
  [Dev team status file format](PLAN.md#dev-team-status-file-format) and
  [Host status files (M5, M6)](PLAN.md#host-status-files-m5-m6). Don't duplicate them here.

## Commands

- Install: `npm ci` in `api/` and `web/` (not `npm install`). `api` postinstall runs `prisma generate`.
- Run (repo root):
  - `npm run all` — local dev: API + Postgres (Docker) plus Angular dev server. Portable.
  - `npm run all:homebrain` — on the Home Brain host only: same, with `docker-compose.homebrain.yml`
    (host networking for WSL mirrored networking). `npm run backend[:homebrain]` / `npm run frontend` run one half.
- Test:
  - Root: `npm test` (dev-all script and the `ci.yml` guard).
  - `api/`: `npm test`. DB tests skip unless `DATABASE_URL` is set; migrate first with `npm run db:deploy`.
  - `web/`: `npm test` (and `node --test allow-scripts.test.mjs`). `npm run build` for a production build.
- Migrate (`api/`): `npm run db:migrate` (`prisma migrate dev`, creates migrations),
  `npm run db:deploy` (`prisma migrate deploy`, applies them), `npm run db:generate`.

## CI

- A PR isn't done until the `ci` check (`.github/workflows/ci.yml`) is green. It runs the installs,
  tests above (api against a `postgres:16` service) and the web build on Node 24. Keep the job id
  `ci` with no `name:`, `contents: read`, no secrets, never `pull_request_target`.

## Conventions

- Prisma schema changes only via a new migration (`npm run db:migrate`); never hand-edit the
  schema or tables against a running DB.
- Config only from env vars listed in `.env.example`. New config means a new documented entry
  there, not an ad hoc config file or flag.
- `package-lock.json` stays committed (root, `api/`, `web/`). Docker builds use `npm ci`. A lockfile
  change needs a matching `package.json` change, or reviewers flag it.

## Skills

- [add-dashboard-card](.claude/skills/add-dashboard-card/SKILL.md) — existing Angular
  service/card, polling, state, history-strip, test and home-registration patterns.

## Gotchas learned on the Home Brain

- Syncthing (8384) and CouchDB (5984) listen on `127.0.0.1` only on the host; containers that need
  them use host networking (`docker-compose.homebrain.yml`).
- WSL mirrored networking: a host-network container can't reach a Docker-published `127.0.0.1`
  port. Run that dependency on the host network too (see `postgres` on 5434 in the homebrain override).
- Builders' dev database: `127.0.0.1:5433` (user `dev`, password `dev`, db `dev`). Port 5434 is the
  dashboard's own Postgres — don't confuse the two.
- `.env.example` is the only env file ever committed — never commit a real `.env` (or `api/.env`).

## Security rules

- Public repo — never commit secrets, tokens, passwords, or real `.env` files.
- The dashboard never gets Hermes API keys, restic passwords, Docker socket access, or bot log files.

Keep this file current: if you learn something the next builder needs, add it here in the same PR.
