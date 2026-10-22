const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { createCouchdbStatus, startCouchdbPolling, pollingInterval } = require('../src/status/couchdb');
const { createApp } = require('../src/app');

function memoryStore() {
  const rows = [];
  return {
    rows,
    async record(row) { rows.unshift(row); },
    async history(service, { limit }) {
      assert.equal(service, 'couchdb');
      assert.equal(limit, 100);
      return rows.filter((row) => row.service === service).slice(0, limit);
    },
  };
}
const healthy = { reachable: true };

test('empty startup does not trigger a read', async () => {
  const status = createCouchdbStatus({ store: memoryStore(), read: () => assert.fail('unexpected read') });
  assert.deepEqual(await status.getStatus(), { current: null, history: [] });
});

test('persists healthy readings and bounded newest-first history across service instances', async () => {
  const store = memoryStore();
  const status = createCouchdbStatus({ store, read: async () => healthy });
  await status.poll();
  assert.equal(store.rows[0].service, 'couchdb');
  assert.equal(store.rows[0].status, 'healthy');
  assert.deepEqual(store.rows[0].detail, healthy);
  assert.ok(store.rows[0].recordedAt instanceof Date);
  for (let i = 0; i < 101; i++) await status.poll();
  const result = await createCouchdbStatus({ store }).getStatus();
  assert.equal(result.history.length, 100);
  assert.deepEqual(result.current, result.history[0]);
});

for (const [name, reading] of Object.entries({
  unreachable: { reachable: false, error: 'CouchDB /_up request failed' },
  'unexpected HTTP status': { reachable: false, error: 'CouchDB /_up request returned an unexpected status' },
  'read failure': { reachable: true, error: 'CouchDB check error' },
})) {
  test(`${name} records unhealthy and preserves previous history`, async () => {
    const store = memoryStore();
    let value = healthy;
    const status = createCouchdbStatus({ store, read: async () => value });
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
  const status = createCouchdbStatus({ store, read: async () => {
    if (fail) throw new Error('private credentials');
    return healthy;
  } });
  await assert.rejects(status.poll(), { message: 'CouchDB check failed unexpectedly' });
  assert.equal((await status.getStatus()).current.status, 'unknown');
  assert.ok(!JSON.stringify(store.rows).includes('private credentials'));
  fail = false;
  await status.poll();
  assert.equal((await status.getStatus()).current.status, 'healthy');
});

test('interval configuration and explicit polling intervals validate timer range', () => {
  assert.equal(pollingInterval('30000'), 30000);
  for (const value of ['', 'x', '0', '-1', '1.5', '2147483648']) {
    assert.throws(() => pollingInterval(value), /COUCHDB_POLL_INTERVAL_MS/);
    assert.throws(() => startCouchdbPolling({ poll() {}, intervalMs: value }), /COUCHDB_POLL_INTERVAL_MS/);
  }
});

test('polling starts immediately, retries errors without overlap and drains on stop', { timeout: 10000 }, async () => {
  let calls = 0;
  let active = 0;
  let errors = 0;
  let ready;
  const third = new Promise((resolve) => { ready = resolve; });
  const stop = startCouchdbPolling({ intervalMs: 1, onError: () => { errors++; }, poll: async () => {
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

test('GET couchdb serves persisted snapshots, empty startup, and safe errors', async (t) => {
  const store = memoryStore();
  const status = createCouchdbStatus({ store, read: async () => healthy });
  const server = createApp({ couchdbStatus: status }).listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/status/couchdb`;
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
  assert.deepEqual(await failed.json(), { error: 'CouchDB status unavailable' });
});
