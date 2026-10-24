Use when adding a new API endpoint that reads a host status file or host service.

## Steps

1. **Configure the source.** Follow `.env.example`: `HOST_STATUS_DIR` for backup/bot
   files, `TEAM_STATUS_DIR` for team files, `SYNCTHING_URL` / `COUCHDB_URL` for
   services, and service-prefixed settings such as `SYNCTHING_API_KEY`,
   `SYNCTHING_FOLDERS`, and `BACKUP_POLL_INTERVAL_MS`. Read env defaults through
   injectable reader options; do not hardcode deployment paths or credentials.
   Document every new variable, default, units and meaning in `.env.example` and
   the relevant `README.md` section. For Docker, follow `docker-compose.yml`'s
   env forwarding/read-only mounts; loopback services use
   `docker-compose.homebrain.yml` host networking as documented in README.

2. **Read and validate in the checks layer.** Readers perform source I/O and
   normalization, without Express routing, polling or database writes. Match the
   source's existing failure contract rather than treating every failure as empty:

   - `api/src/checks/backup.js`: missing `backup.json` (`ENOENT`) returns `null`;
     invalid JSON/fields throw `Invalid backup status`; other reads throw
     `Backup status unavailable`. Copy known fields, normalize absent fields to
     `null`, validate timezone-bearing timestamps and nonnegative numeric metrics.
   - `api/src/checks/bots.js`: missing/unparseable files become `present: false`;
     unexpected read errors propagate. Copy schema fields only, normalize invalid
     values to `null`, and flag missing/invalid or older-than-three-minute
     `checked_at` as stale. `api/src/checks/team.js` returns empty arrays for
     missing roster/directory, skips bad instance files, and propagates invalid
     roster or unexpected directory errors; instance reads are sequential.
   - `api/src/checks/syncthing.js` and `api/src/checks/couchdb.js`: validate HTTP(S)
     URLs without credentials/query/fragment, disable redirects, use injected
     fetch and five-second abort timeouts. Return safe errors without response
     bodies/client exception details. Syncthing requires its API key and HTTP
     200, validates payloads, and preserves successful partial readings with an
     error. CouchDB uses unauthenticated `GET /_up`, falls back to `/` only on
     404, and treats 200 **or 401** as reachable.

3. **Choose history from PLAN.md, then implement the status layer.** M3/M4
   require uptime/incident history; “Dev team status file format” and M6 specify
   live-only team/bot state because their files are the source of truth. M5
   requires completed backup runs because the file retains only current/previous.

   - `api/src/status/syncthing.js` and `api/src/status/couchdb.js` classify each
     poll and call `api/src/db/snapshots.js` with service, `healthy`/`unhealthy`
     (or safe `unknown` on unexpected check exceptions), detail and timestamp.
     Syncthing folder errors/outstanding items/bytes also mean unhealthy.
     `getStatus()` reads up to 100 newest-first rows as `{ current, history }`;
     it does not invoke the reader. Empty history means `current: null`.
   - `api/src/status/backups.js` caches the polled current reading, recalculates
     its 26-hour stale flag per request, and uses `api/src/db/backup-runs.js`
     for up to ten newest completed runs. Store only `ok`/`failed`/`skipped`
     with a newer `finished_at`; inspect `previous` while running. The store's
     newest-row check and unique completion timestamp with `skipDuplicates`
     prevent duplicate runs across polls/restarts. Missing files preserve history.
   - `api/src/status/team.js` composes live roster/active/recent lists, selects
     the highest numeric instance per name, filters active phases and projects
     public job fields. `api/src/status/bots.js` wraps live reads as `{ bots }`.
     Neither polls nor persists snapshots.

   For polled services, follow `api/src/server.js`: start immediately, validate
   interval integers in 1..2147483647 (default 30000 ms), schedule after completion
   to avoid overlap, retry failures, and drain polls before disconnecting Prisma
   on shutdown. History is currently retained indefinitely.

4. **Wire the Express route in `api/src/app.js`.** Inject a status service through
   `createApp`, await `getStatus()` and return JSON. Existing routes are
   `/api/status/syncthing`, `/api/status/couchdb`, `/api/status/backups`,
   `/api/status/bots`, and `/api/team/status`. Catch unavailable reads/storage
   failures as HTTP 503 with a fixed service-specific `{ error }`, never raw
   exception details. An unhealthy reading itself is a successful HTTP 200 response.

## Tests

Use `node:test` in `api/test`, following these existing assertions:

- `api/test/backup.test.js`, `api/test/bots.test.js`, `api/test/team.test.js` use
  temporary file fixtures: valid/missing/malformed files, read failures, field
  filtering, staleness boundaries, completion detection and numeric team ordering.
- `api/test/syncthing.test.js` and `api/test/couchdb.test.js` inject fetch fixtures:
  config validation, HTTP/network failures, safe errors, partial Syncthing results,
  CouchDB 200/401 and 404 fallback; CouchDB also explicitly tests timeout aborts.
- `api/test/syncthing-status.test.js`, `api/test/couchdb-status.test.js`, and
  `api/test/backups-status.test.js` inject readers/stores: startup, bounded history,
  recovery, interval validation, non-overlap and shutdown draining. They also run
  endpoint tests with `createApp(...).listen(0)` for JSON and safe 503 responses.
  `api/test/bots-status.test.js` and `api/test/team.test.js` verify live endpoint
  updates, unavailable sources, recovery and omission of private fields.
- `api/test/snapshots.test.js` checks Prisma calls with a fake client and gates
  real insert/read/order/limit/grouped-service tests on `DATABASE_URL`;
  `api/test/backups-status.test.js` likewise gates PostgreSQL history/restart
  deduplication. Run `npm ci`, then `npm test` in `api/`; with a test database,
  run `npm run db:deploy` before `npm test` so these tests do not skip.
