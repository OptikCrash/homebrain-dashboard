const { readFile } = require('node:fs/promises');
const path = require('node:path');

const STALE_AFTER_MS = 26 * 60 * 60 * 1000;
const completedStates = new Set(['ok', 'failed', 'skipped']);

function timestamp(value) {
  // Require a timezone so parsing never depends on the API host's local time.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  return Date.parse(value);
}

function parseRun(value, previous = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !(completedStates.has(value.state) || (!previous && value.state === 'running'))) {
    throw new Error('Invalid backup status');
  }
  const run = { state: value.state };
  for (const field of ['started_at', 'finished_at', 'last_success']) {
    const entry = value[field] ?? null;
    if (entry !== null && !Number.isFinite(timestamp(entry))) throw new Error('Invalid backup status');
    run[field] = entry;
  }
  if (completedStates.has(run.state) && run.finished_at === null) throw new Error('Invalid backup status');
  if (run.state === 'running' && run.finished_at !== null) throw new Error('Invalid backup status');
  for (const field of ['error', 'snapshot_id']) {
    const entry = value[field] ?? null;
    if (entry !== null && typeof entry !== 'string') throw new Error('Invalid backup status');
    run[field] = entry;
  }
  for (const field of ['files_total', 'bytes_total', 'bytes_added', 'duration_s']) {
    const entry = value[field] ?? null;
    if (entry !== null && (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0
      || (field !== 'duration_s' && !Number.isSafeInteger(entry)))) throw new Error('Invalid backup status');
    run[field] = entry;
  }
  if (!previous) {
    run.previous = run.state === 'running' && value.previous != null ? parseRun(value.previous, true) : null;
  }
  return run;
}

async function readBackupStatus({ dir = process.env.HOST_STATUS_DIR || '/srv/homebrain/status' } = {}) {
  let contents;
  try {
    contents = await readFile(path.join(dir, 'backup.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Backup status unavailable');
  }
  try {
    return parseRun(JSON.parse(contents));
  } catch {
    throw new Error('Invalid backup status');
  }
}

// No successful backup yet is not an aged success; consumers can show it separately.
function isBackupStale(lastSuccess, now = Date.now()) {
  const success = timestamp(lastSuccess);
  const current = now instanceof Date ? now.getTime() : now;
  return Number.isFinite(success) && Number.isFinite(current) && current - success > STALE_AFTER_MS;
}

// lastFinishedAt may be the Date returned by Prisma or a persisted ISO string.
function isNewCompletedRun(run, lastFinishedAt = null) {
  if (!run || !completedStates.has(run.state)) return false;
  const finished = timestamp(run.finished_at);
  if (!Number.isFinite(finished)) return false;
  if (lastFinishedAt === null) return true;
  const stored = lastFinishedAt instanceof Date ? lastFinishedAt.getTime() : timestamp(lastFinishedAt);
  return Number.isFinite(stored) && finished > stored;
}

module.exports = { readBackupStatus, isBackupStale, isNewCompletedRun };
