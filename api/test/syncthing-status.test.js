const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { createSyncthingStatus, startSyncthingPolling, pollingInterval } = require('../src/status/syncthing');
const { createApp } = require('../src/app');

function memoryStore() {
  const rows = [];
  return {
    rows,
    async record(row) { rows.unshift(row); },
    async history(service, { limit }) {
      assert.equal(service, 'syncthing');
      assert.equal(limit, 100);
      return rows.filter((row) => row.service === service).slice(0, limit);
    },
  };
}
const folder = { id: 'notes', state: 'idle', errors: 0, needItems: 0, needBytes: 0 };
const healthy = { reachable: true, folders: [folder], connections: { device: { connected: true } } };

test('empty startup does not trigger a read', async () => {
  const status = createSyncthingStatus({ store: memoryStore(), read: () => assert.fail('unexpected read') });
  assert.deepEqual(await status.getStatus(), { current: null, history: [] });
});

test('persists healthy readings and bounded newest-first history across service instances', async () => {
  const store = memoryStore();
  const status = createSyncthingStatus({ store, read: async () => healthy });
  await status.poll();
  assert.equal(store.rows[0].service, 'syncthing');
  assert.equal(store.rows[0].status, 'healthy');
  assert.deepEqual(store.rows[0].detail, healthy);
  assert.ok(store.rows[0].recordedAt instanceof Date);
  for (let i = 0; i < 101; i++) await status.poll();
  const result = await createSyncthingStatus({ store }).getStatus();
  assert.equal(result.history.length, 100);
  assert.deepEqual(result.current, result.history[0]);
});

for (const [name, reading] of Object.entries({
  unreachable: { reachable: false, folders: [], error: 'Syncthing system/status request failed' },
  'partial read failure': { ...healthy, error: 'Syncthing db/status request failed' },
  'folder errors': { ...healthy, folders: [{ ...folder, errors: 1 }] },
  'outstanding items': { ...healthy, folders: [{ ...folder, needItems: 1 }] },
  'outstanding bytes': { ...healthy, folders: [{ ...folder, needBytes: 1 }] },
  'folder error state': { ...healthy, folders: [{ ...folder, state: 'error' }] },
})) {
  test(`${name} records unhealthy and preserves previous history`, async () => {
    const store = memoryStore();
    let value = healthy;
    const status = createSyncthingStatus({ store, read: async () => value });
    await status.poll();
    value = reading;
    await status.poll();
    const { current, history } = await status.getStatus();
    assert.equal(current.status, 'unhealthy');
    assert.deepEqual(store.rows[0].detail, reading);
    assert.equal(history[1].status, 'healthy');
  });
}

test('unexpected reader exception records unknown safely and recovers on next poll', async () => {
  const store = memoryStore();
  let fail = true;
  const status = createSyncthingStatus({ store, read: async () => {
    if (fail) throw new Error('private credentials');
    return healthy;
  } });
  await assert.rejects(status.poll(), { message: 'Syncthing check failed unexpectedly' });
  assert.equal((await status.getStatus()).current.status, 'unknown');
  assert.ok(!JSON.stringify(store.rows).includes('private credentials'));
  fail = false;
  await status.poll();
  assert.equal((await status.getStatus()).current.status, 'healthy');
});

test('interval configuration and explicit polling intervals validate timer range', () => {
  assert.equal(pollingInterval('30000'), 30000);
  for (const value of ['', 'x', '0', '-1', '1.5', '2147483648']) {
    assert.throws(() => pollingInterval(value), /SYNCTHING_POLL_INTERVAL_MS/);
    assert.throws(() => startSyncthingPolling({ poll() {}, intervalMs: value }), /SYNCTHING_POLL_INTERVAL_MS/);
  }
});

test('polling starts immediately, retries errors without overlap and drains on stop', { timeout: 10000 }, async () => {
  let calls = 0;
  let active = 0;
  let errors = 0;
  let ready;
  const third = new Promise((resolve) => { ready = resolve; });
  const stop = startSyncthingPolling({ intervalMs: 1, onError: () => { errors++; }, poll: async () => {
    calls++;
    assert.equal(active++, 0);
    await delay(5);
    active--;
    if (calls === 1) throw new Error('temporary failure');
    if (calls === 3) ready();
  } });
  try { await third; } finally { await stop(); }
  assert.equal(errors, 1);
  assert.equal(active, 0);
  const stoppedAt = calls;
  await delay(15);
  assert.equal(calls, stoppedAt);
});

test('GET syncthing serves persisted snapshots, empty startup, and safe errors', async (t) => {
  const store = memoryStore();
  const status = createSyncthingStatus({ store, read: async () => healthy });
  const server = createApp({ syncthingStatus: status }).listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/status/syncthing`;
  assert.deepEqual(await (await fetch(url)).json(), { current: null, history: [] });
  await status.poll();
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.current.status, 'healthy');
  assert.equal(typeof body.current.recordedAt, 'string');
  assert.deepEqual(body.current, body.history[0]);
  store.history = async () => { throw new Error('private database details'); };
  const failed = await fetch(url);
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: 'Syncthing status unavailable' });
});
