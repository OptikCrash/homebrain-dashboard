const { readBuilderStatus } = require('../checks/builders');
const { snapshots } = require('../db/snapshots');

const PREFIX = 'dev-builders:';
const HISTORY_LIMIT = 100;

function pollingInterval(value = process.env.BUILDER_POLL_INTERVAL_MS ?? '30000') {
  const interval = Number(value);
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > 2147483647) {
    throw new TypeError('BUILDER_POLL_INTERVAL_MS must be an integer between 1 and 2147483647');
  }
  return interval;
}

function createBuilderStatus({ store = snapshots, read = readBuilderStatus } = {}) {
  async function poll() {
    const reading = await read();
    const recordedAt = new Date();
    const known = await store.services(PREFIX);
    const names = new Set([...known.map((key) => key.slice(PREFIX.length)),
      ...Object.keys(reading.builders ?? {})]);
    for (const name of names) {
      const builder = reading.available ? reading.builders?.[name] : null;
      const jobs = (reading.jobs ?? []).filter((job) => job.target?.builder === name);
      await store.record({
        service: PREFIX + name,
        status: !builder ? 'unknown' : jobs.some((job) => job.stale) ? 'unhealthy' : 'healthy',
        detail: {
          name,
          state: builder?.state ?? 'unknown',
          jobs,
          available: reading.available,
          ...(reading.error ? { error: reading.error } : {}),
        },
        recordedAt,
      });
    }
  }

  async function getStatus() {
    const services = await store.services(PREFIX);
    const builders = await Promise.all(services.map(async (service) => {
      const rows = await store.history(service, { limit: HISTORY_LIMIT });
      const history = rows.map(({ status, detail, recordedAt }) => ({ status, ...detail, recordedAt }));
      return { name: service.slice(PREFIX.length), current: history[0] ?? null, history };
    }));
    return { builders };
  }

  return { poll, getStatus };
}

// Schedule after completion so slow reads/writes never overlap. Failures are
// logged and retried on the next interval; shutdown drains an in-flight poll.
function startBuilderPolling({ poll, intervalMs = pollingInterval(), onError = console.error }) {
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

module.exports = { createBuilderStatus, startBuilderPolling, pollingInterval };
