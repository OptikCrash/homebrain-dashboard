const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { createBuilderStatus, startBuilderPolling, pollingInterval } = require('../src/status/builders');
const { createApp } = require('../src/app');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readBuilderStatus } = require('../src/checks/builders');

function memoryStore() {
  const rows = [];
  return {
    rows,
    async services(prefix) { return [...new Set(rows.map((row) => row.service))].filter((key) => key.startsWith(prefix)).sort(); },
    async record(row) { rows.unshift(row); },
    async history(service, { limit }) { return rows.filter((row) => row.service === service).slice(0, limit); },
  };
}

const job = { name: 'issue-5-codex', target: { builder: 'codex', kind: 'issue', number: 5 }, state: 'running', stale: false };
const reading = { available: true, builders: { codex: { state: 'running' }, claude: { state: 'idle' } }, jobs: [job] };

test('review jobs survive reading, persistence and status history through their lifecycle', async (t) => {
  const logsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'builder-review-'));
  t.after(() => fs.rm(logsDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(logsDir, 'review-10.pid'), '123');
  await fs.writeFile(path.join(logsDir, 'review-10.log'), 'Reviewing PR #10\n');
  const store = memoryStore();
  let now = Date.now();
  const status = createBuilderStatus({ store, read: () => readBuilderStatus({ logsDir, now }) });
  await status.poll();
  const active = (await status.getStatus()).builders[0];
  assert.equal(active.name, 'review-10');
  assert.equal(store.rows[0].service, 'dev-builders:review-10');
  assert.equal(active.current.state, 'running');
  assert.equal(active.current.status, 'healthy');
  assert.deepEqual(active.current.jobs[0].target, { kind: 'pr', number: 10 });
  assert.equal(active.current.jobs[0].lastLogLine, 'Reviewing PR #10');
  now += 3 * 60 * 60 * 1000;
  await status.poll();
  assert.equal((await status.getStatus()).builders[0].current.status, 'unhealthy');
  await fs.writeFile(path.join(logsDir, 'review-10.done'), 'done');
  await status.poll();
  assert.equal((await status.getStatus()).builders[0].current.state, 'idle');
  await fs.unlink(path.join(logsDir, 'review-10.pid'));
  await status.poll();
  const { current, history } = (await status.getStatus()).builders[0];
  assert.equal(current.status, 'unknown');
  assert.equal(history.length, 4);
  assert.equal(history[1].status, 'healthy');
  assert.deepEqual(history[3].jobs, active.current.jobs);
});

test('records each builder on every poll and exposes bounded newest-first history', async () => {
  const store = memoryStore();
  let value = reading;
  const status = createBuilderStatus({ store, read: async () => value });
  await status.poll();
  value = { ...reading, jobs: [{ ...job, stale: true }] };
  await status.poll();
  assert.equal(store.rows.length, 4);
  let result = await status.getStatus();
  const codex = result.builders.find((builder) => builder.name === 'codex');
  assert.equal(codex.current.status, 'unhealthy');
  assert.equal(codex.current.state, 'running');
  assert.equal(codex.history[1].status, 'healthy');
  assert.equal(result.builders[0].current.state, 'idle');
  assert.ok(codex.current.recordedAt instanceof Date);
  for (let i = 0; i < 101; i++) await status.poll();
  result = await status.getStatus();
  assert.equal(result.builders[0].history.length, 100);
});

test('missing builders and failed reads record unknown without losing history', async () => {
  const store = memoryStore();
  let value = reading;
  const status = createBuilderStatus({ store, read: async () => value });
  await status.poll();
  value = { available: true, builders: {}, jobs: [] };
  await status.poll();
  assert.equal((await status.getStatus()).builders[0].current.state, 'unknown');
  value = { available: false, error: 'ENOENT', jobs: [] };
  await status.poll();
  const { current, history } = (await status.getStatus()).builders[0];
  assert.equal(current.status, 'unknown');
  assert.equal(current.available, false);
  assert.equal(current.error, 'ENOENT');
  assert.equal(history.length, 3);
});

test('interval configuration validates timer range', () => {
  assert.equal(pollingInterval('30000'), 30000);
  for (const value of ['', 'x', '0', '-1', '1.5', '2147483648']) {
    assert.throws(() => pollingInterval(value), /BUILDER_POLL_INTERVAL_MS/);
  }
});

test('polling starts immediately, retries failures, never overlaps and drains on stop', { timeout: 10000 }, async () => {
  let calls = 0;
  let active = 0;
  let errors = 0;
  let resolveThird;
  const third = new Promise((resolve) => { resolveThird = resolve; });
  const stop = startBuilderPolling({
    intervalMs: 1,
    onError: () => { errors++; },
    poll: async () => {
      calls++;
      assert.equal(active++, 0);
      await delay(5);
      active--;
      if (calls === 1) throw new Error('temporary failure');
      if (calls === 3) resolveThird();
    },
  });
  try { await third; } finally { await stop(); }
  assert.equal(errors, 1);
  assert.equal(active, 0);
  const stoppedAt = calls;
  await delay(15);
  assert.equal(calls, stoppedAt);
});

test('GET builders returns JSON snapshots, empty startup and safe database errors', async (t) => {
  const store = memoryStore();
  const status = createBuilderStatus({ store, read: async () => reading });
  const server = createApp({ builderStatus: status }).listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/status/builders`;
  assert.deepEqual(await (await fetch(url)).json(), { builders: [] });
  await status.poll();
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.builders.length, 2);
  assert.equal(typeof body.builders[0].current.recordedAt, 'string');
  assert.deepEqual(body.builders[0].current, body.builders[0].history[0]);
  store.services = async () => { throw new Error('private database details'); };
  const failed = await fetch(url);
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: 'Builder status unavailable' });
});

test('polling accumulates real Prisma rows served by the endpoint', { skip: !process.env.DATABASE_URL, timeout: 10000 }, async (t) => {
  const { snapshots } = require('../src/db/snapshots');
  const { getPrisma, disconnectPrisma } = require('../src/db/prisma');
  const name = `test-${process.pid}-${Date.now()}`;
  const service = `dev-builders:${name}`;
  // Isolate discovery from any existing development snapshots.
  const store = { ...snapshots, services: async () => [service] };
  const status = createBuilderStatus({ store, read: async () => ({ available: true, builders: { [name]: { state: 'idle' } }, jobs: [] }) });
  t.after(async () => {
    await getPrisma().statusSnapshot.deleteMany({ where: { service } });
    await disconnectPrisma();
  });
  let polls = 0;
  let resolve;
  const ready = new Promise((done) => { resolve = done; });
  const stop = startBuilderPolling({ intervalMs: 5, poll: async () => { await status.poll(); if (++polls === 2) resolve(); } });
  t.after(stop);
  try { await ready; } finally { await stop(); }
  assert.ok(await getPrisma().statusSnapshot.count({ where: { service } }) >= 2);
  assert.ok((await snapshots.services('dev-builders:')).includes(service));
  const server = createApp({ builderStatus: status }).listen(0);
  t.after(() => new Promise((done) => server.close(done)));
  await new Promise((done) => server.once('listening', done));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/status/builders`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.builders[0].name, name);
  assert.ok(body.builders[0].history.length >= 2);
});
