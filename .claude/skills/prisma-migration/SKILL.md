Use when a change requires a new or changed Postgres table, column, index, or constraint.

## Steps

1. **Edit `api/prisma/schema.prisma`.** Follow the two existing migrations:
   `20261022000000_status_snapshots` creates `ServiceStatus`, `status_snapshots`
   and its `(service, recorded_at)` index for per-service history queries;
   `20261023000000_backup_runs` creates `backup_run_snapshots` with a unique
   `finished_at` index for completion deduplication and newest-first reads.
   Models use auto-incrementing integer IDs, JSON details, timestamp defaults,
   and `@map` / `@@map` for snake_case database names. Keep indexes aligned
   with the queries that will read the data.

2. **Generate a new migration against live development Postgres.** Run commands
   from `api/`, after `npm ci` (whose postinstall generates Prisma Client).
   Set `DATABASE_URL` in your shell to the builders' database at `127.0.0.1:5433`,
   with user, password and database all `dev`; do not commit an env file or
   connection credentials. Port 5434 is the dashboard's own database.
   Run `npm run db:migrate -- --name <descriptive_name>` (`prisma migrate dev`).
   This checks migration history/drift using a shadow database, generates a
   timestamped migration, applies it locally and generates Prisma Client.
   The dev role needs permission to create the shadow database. If Prisma asks
   to reset because of drift, investigate before accepting a destructive reset.

3. **Review the generated SQL.** Migrations already merged are immutable;
   never hand-edit an already-applied migration under `migrations/`. Fix mistakes
   with a new migration. Generate SQL with Prisma rather than writing it by
   hand, except when Prisma cannot express the change. The existing backup
   migration's `CHECK ("state" IN ('ok', 'failed', 'skipped'))` is one such
   database constraint: the Prisma model only declares `state String`.
   For such changes, use `npm run db:migrate -- --create-only --name <name>`,
   edit only the new, unapplied SQL, then run `npm run db:migrate` to apply it.
   Preserve existing SQL-only constraints when reviewing subsequent migrations.

4. **Test against the real dev database before opening a PR.** Keep the same
   `DATABASE_URL` exported and run `npx prisma migrate status` and `npm test`
   from `api/`. Confirm all migrations are applied and add/update relevant
   `api/test/*.test.js` insert/read/constraint tests so the changed behavior is
   exercised against Postgres; DB tests skip without `DATABASE_URL`.
   `migrate status` checks migration history, not schema drift by itself:
   also require the preceding `migrate dev` run to report no drift.

5. **Deploy committed migrations; generate the client separately when needed.**
   `npm run db:deploy` (`prisma migrate deploy`) applies pending migrations in
   CI/production without creating migrations or checking schema drift. CI runs
   it before API tests; the API Docker startup runs the equivalent command.
   `npm run db:generate` (`prisma generate`) regenerates Prisma Client from
   the schema without changing the database; `npm ci` also runs it. Neither
   command replaces local `db:migrate` when authoring a schema change.

## Files involved

- `api/prisma/schema.prisma` — models, enum, mappings and indexes.
- `api/prisma/migrations/<timestamp>_<name>/migration.sql` — versioned SQL.
- `api/prisma/migrations/migration_lock.toml` — committed PostgreSQL provider
  lock; Prisma manages it, do not edit manually.

## Checklist

- [ ] Schema edited and query indexes considered.
- [ ] New migration generated, not hand-written unless Prisma cannot express it.
- [ ] Merged/applied migrations left unchanged.
- [ ] Migration and affected behavior tested against the real dev DB on 5433.
- [ ] `npx prisma migrate status` is up to date; `migrate dev` reports no drift.
- [ ] API tests pass with `DATABASE_URL` set.
