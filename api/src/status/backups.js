const { readBackupStatus, isBackupStale, isNewCompletedRun } = require('../checks/backup');
const { backupRuns } = require('../db/backup-runs');

function pollingInterval(value = process.env.BACKUP_POLL_INTERVAL_MS ?? '30000') {
  const interval = Number(value);
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > 2147483647) {
    throw new TypeError('BACKUP_POLL_INTERVAL_MS must be an integer between 1 and 2147483647');
  }
  return interval;
}

function createBackupStatus({ store = backupRuns, read = readBackupStatus, now = Date.now } = {}) {
  let current = null;
  let unavailable = false;
  async function poll() {
    try {
      current = await read();
      unavailable = false;
      const run = current?.state === 'running' ? current.previous : current;
      if (isNewCompletedRun(run)) await store.record(run);
    } catch {
      unavailable = true;
      throw new Error('Backup status unavailable');
    }
  }
  async function getStatus() {
    if (unavailable) throw new Error('Backup status unavailable');
    const rows = await store.history({ limit: 10 });
    return {
      current: current ? { ...current, stale: isBackupStale(current.last_success, now()) } : null,
      history: rows.map((row) => ({ ...row.detail, previous: null, state: row.state,
        finished_at: row.finishedAt.toISOString(), snapshot_id: row.snapshotId,
        bytes_added: row.bytesAdded == null ? null : Number(row.bytesAdded) })),
    };
  }
  return { poll, getStatus };
}

function startBackupPolling({ poll, intervalMs = pollingInterval(), onError = console.error }) {
  intervalMs = pollingInterval(intervalMs);
  let stopped = false;
  let timer;
  let pending;
  function run() {
    pending = Promise.resolve().then(poll).catch(onError).finally(() => {
      if (!stopped) timer = setTimeout(run, intervalMs);
    });
  }
  run();
  return async function stop() {
    stopped = true;
    clearTimeout(timer);
    await pending;
  };
}

module.exports = { createBackupStatus, startBackupPolling, pollingInterval };
