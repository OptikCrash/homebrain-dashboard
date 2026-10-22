const { readCouchdbStatus } = require('../checks/couchdb');
const { snapshots } = require('../db/snapshots');

const SERVICE = 'couchdb';
const HISTORY_LIMIT = 100;

function pollingInterval(value = process.env.COUCHDB_POLL_INTERVAL_MS ?? '30000') {
  const interval = Number(value);
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > 2147483647) {
    throw new TypeError('COUCHDB_POLL_INTERVAL_MS must be an integer between 1 and 2147483647');
  }
  return interval;
}

function createCouchdbStatus({ store = snapshots, read = readCouchdbStatus } = {}) {
  async function poll() {
    let reading;
    try {
      reading = await read();
    } catch {
      // Exceptions may contain credentials. Persist and report only a safe error.
      await store.record({
        service: SERVICE, status: 'unknown',
        detail: { error: 'CouchDB check failed unexpectedly' }, recordedAt: new Date(),
      });
      throw new Error('CouchDB check failed unexpectedly');
    }
    const unhealthy = !reading.reachable || Boolean(reading.error);
    await store.record({
      service: SERVICE,
      status: unhealthy ? 'unhealthy' : 'healthy',
      detail: {
        reachable: reading.reachable,
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

function startCouchdbPolling({ poll, intervalMs = pollingInterval(), onError = console.error }) {
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

module.exports = { createCouchdbStatus, startCouchdbPolling, pollingInterval };
