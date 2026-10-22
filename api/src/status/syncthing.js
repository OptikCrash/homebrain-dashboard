const { readSyncthingStatus } = require('../checks/syncthing');
const { snapshots } = require('../db/snapshots');

const SERVICE = 'syncthing';
const HISTORY_LIMIT = 100;

function pollingInterval(value = process.env.SYNCTHING_POLL_INTERVAL_MS ?? '30000') {
  const interval = Number(value);
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > 2147483647) {
    throw new TypeError('SYNCTHING_POLL_INTERVAL_MS must be an integer between 1 and 2147483647');
  }
  return interval;
}

function createSyncthingStatus({ store = snapshots, read = readSyncthingStatus } = {}) {
  async function poll() {
    let reading;
    try {
      reading = await read();
    } catch {
      // Exceptions may contain credentials. Persist and report only a safe error.
      await store.record({
        service: SERVICE, status: 'unknown',
        detail: { error: 'Syncthing check failed unexpectedly' }, recordedAt: new Date(),
      });
      throw new Error('Syncthing check failed unexpectedly');
    }
    const unhealthy = !reading.reachable || Boolean(reading.error) ||
      reading.folders.some((folder) => folder.errors > 0 || folder.needItems > 0 ||
        folder.needBytes > 0 || folder.state === 'error');
    await store.record({
      service: SERVICE,
      status: unhealthy ? 'unhealthy' : 'healthy',
      detail: {
        reachable: reading.reachable,
        folders: reading.folders,
        ...(reading.connections ? { connections: reading.connections } : {}),
        ...(reading.error ? { error: reading.error } : {}),
      },
      recordedAt: new Date(),
    });
  }

  async function getStatus() {
    const rows = await store.history(SERVICE, { limit: HISTORY_LIMIT });
    const history = rows.map(({ status, detail, recordedAt }) => ({ status, ...detail, recordedAt }));
    return { current: history[0] ?? null, history };
  }

  return { poll, getStatus };
}

function startSyncthingPolling({ poll, intervalMs = pollingInterval(), onError = console.error }) {
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

module.exports = { createSyncthingStatus, startSyncthingPolling, pollingInterval };
