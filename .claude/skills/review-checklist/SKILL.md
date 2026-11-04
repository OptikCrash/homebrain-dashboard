---
name: review-checklist
description: Use when reviewing a pull request against this repo's standards.
---

Use when reviewing a pull request against this repo's standards.

Read `AGENTS.md`, `PLAN.md`, and the PR diff itself (including changed tests).
Check issue alignment and correctness alongside the severity-ordered checks below.
[Hera's actual review prompt](https://github.com/OptikCrash/homebrain-dashboard/pull/17#issuecomment-6348322163)
asks for concrete file/line findings, blocking only real problems and saying what fixes them.

1. **Security.** No committed secrets, tokens, credentials, or real `.env` files;
   `.env.example` is the only committed env file. The dashboard never gets Hermes
   API keys, restic passwords, Docker socket access, or bot log files. Bot-health
   message/reply fields expose timestamps only; message contents must never reach
   the dashboard. Inspect API payloads and mounts as well as rendered output.
   Sources: [AGENTS.md — Security rules and Home Brain gotchas](../../../AGENTS.md#security-rules),
   [PLAN.md — Host status files](../../../PLAN.md#host-status-files-m5-m6).

2. **Tests actually exercise the change.** Follow the branches touched by the diff:
   card loading/empty/error states, and stale states where applicable (M5/M6);
   endpoint fixtures matching real host files, plus DB-gated tests for persisted
   behavior; schema/migration changes applied and tested against a live database.
   Tests merely existing is insufficient: [PR #9](https://github.com/OptikCrash/homebrain-dashboard/pull/9#issuecomment-6344261014)
   passed with invented filenames that missed the host's real layout.
   Sources: [AGENTS.md — Commands, CI, Conventions](../../../AGENTS.md#commands)
   (migrate before DB tests; required `ci` runs against Postgres),
   [PLAN.md — M5/M6](../../../PLAN.md#m5--backups-restic), and Hera's prompt above.
   Check execution evidence and skipped tests; the PR is not done until `ci` is green.

3. **Lockfile vs package.json.** For each changed `package-lock.json` (root, `api/`,
   `web/`), require a corresponding `package.json` change; flag an unmatched diff
   as unexpected/unintended. Lockfiles stay committed and Docker uses `npm ci`.
   Sources: [PLAN.md — Decisions](../../../PLAN.md#decisions),
   [AGENTS.md — Conventions](../../../AGENTS.md#conventions).

4. **Status-file contract.** Compare changed readers and fixtures to
   [PLAN.md — Dev team status file format](../../../PLAN.md#dev-team-status-file-format)
   or [Host status files (M5, M6)](../../../PLAN.md#host-status-files-m5-m6)
   exactly, including nullable/optional fields. Check latest numbered team instance
   selection and terminal phases; nullable `issue`/`pr`; backup metrics available
   after a run and `previous` only while running; bot `readiness: null` when API
   is down. Preserve missing-file behavior and the M5/M6 stale thresholds.
   Use these contracts rather than superseded M1 pid/log behavior.

5. **Performance as data grows.** Trace history/log/snapshot iteration on polling
   and request paths. Avoid unbounded reads of growing data; check query bounds
   and whether deduplication happens after fetching all rows.
   [PR #12's review](https://github.com/OptikCrash/homebrain-dashboard/pull/12#issuecomment-6345655389)
   flagged Prisma `findMany({ distinct: ['service'] })` over the growing snapshot
   table on every poll/request. Verify the fix limits repeated work as data grows;
   Hera's prompt explicitly includes this check.

For Hera or any reviewer, tick through in order (mark inapplicable checks N/A):

- [ ] Security and timestamp-only bot data checked.
- [ ] Changed branches covered; test/DB evidence and required `ci` checked.
- [ ] Each lockfile diff has a matching manifest change.
- [ ] Readers and fixtures match the applicable PLAN.md contract.
- [ ] Growing data does not cause unbounded hot-path reads.
