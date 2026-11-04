const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { readBackupStatus } = require('../src/checks/backup');
const { createBackupStatus, startBackupPolling, pollingInterval } = require('../src/status/backups');
const { createBackupRunStore } = require('../src/db/backup-runs');
const { createApp } = require('../src/app');
const { setTimeout: delay } = require('node:timers/promises');

const run = { state: 'ok', finished_at: '2026-10-22T03:00:00Z', snapshot_id: 'abc', bytes_added: 123 };
function memoryStore() {
  const rows = [];
  return createBackupRunStore({ backupRunSnapshot: {
    async findMany({ take }) { return [...rows].sort((a, b) => b.finishedAt - a.finishedAt).slice(0, take); },
    async createMany({ data }) {
      for (const row of data) if (!rows.some((r) => +r.finishedAt === +row.finishedAt)) rows.push(row);
    },
  } });
}
async function endpoint(t, status) {
  const server = createApp({ backupStatus: status }).listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  return () => fetch(`http://127.0.0.1:${server.address().port}/api/status/backups`);
}

test('endpoint: missing file, running backup, previous run, stale flag and safe errors', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'backups-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const status = createBackupStatus({ store: memoryStore(), read: () => readBackupStatus({ dir }),
    now: () => Date.parse('2026-10-23T06:00:00Z') });
  const get = await endpoint(t, status);
  await status.poll();
  assert.deepEqual(await (await get()).json(), { current: null, history: [] });
  await writeFile(path.join(dir, 'backup.json'), JSON.stringify({ state: 'running',
    last_success: run.finished_at, previous: run }));
  await status.poll();
  await status.poll();
  const response = await get();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.current.state, 'running');
  assert.equal(body.current.stale, true);
  assert.equal(body.current.previous.snapshot_id, 'abc');
  assert.equal(body.history.length, 1);
  assert.equal(body.history[0].bytes_added, 123);
  await writeFile(path.join(dir, 'backup.json'), 'bad json');
  await assert.rejects(status.poll(), /Backup status unavailable/);
  const failed = await get();
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: 'Backup status unavailable' });
  await rm(path.join(dir, 'backup.json'));
  await status.poll();
  assert.equal((await (await get()).json()).current, null);
});

test('completed runs deduplicate across restart; older files ignored, history bounded and newest first', async () => {
  const store = memoryStore();
  const status = createBackupStatus({ store, read: async () => run });
  await status.poll();
  await createBackupStatus({ store, read: async () => run }).poll();
  assert.equal((await store.history()).length, 1);
  for (let day = 1; day <= 21; day++) {
    await store.record({ ...run, state: day % 2 ? 'failed' : 'skipped', finished_at: `2026-11-${String(day).padStart(2, '0')}T03:00:00Z` });
  }
  await status.poll();
  const result = await status.getStatus();
  assert.equal(result.history.length, 10);
  assert.equal(result.history[0].finished_at, '2026-11-21T03:00:00.000Z');
});

test('polling validates configuration, retries without overlap and drains on shutdown', async () => {
  for (const value of ['', '0', '-1', '1.5', '2147483648', 'bad']) assert.throws(() => pollingInterval(value));
  let calls = 0;
  let active = 0;
  let errors = 0;
  let resolve;
  const ready = new Promise((r) => { resolve = r; });
  const stop = startBackupPolling({ intervalMs: 1, onError: () => errors++, poll: async () => {
    assert.equal(active++, 0);
    calls++;
    await delay(5);
    active--;
    if (calls === 1) throw new Error('temporary');
    if (calls === 3) resolve();
  } });
  await ready;
  await stop();
  const stopped = calls;
  await delay(10);
  assert.equal(calls, stopped);
  assert.equal(active, 0);
  assert.equal(errors, 1);
});

test('endpoint returns existing PostgreSQL history and does not duplicate a run after restart', {
  skip: !process.env.DATABASE_URL && 'DATABASE_URL not set',
}, async (t) => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const finishedAt = new Date('2099-12-30T03:00:00Z');
  t.after(async () => {
    await prisma.backupRunSnapshot.deleteMany({ where: { finishedAt } });
    await prisma.$disconnect();
  });
  const store = createBackupRunStore(prisma);
  const reading = { ...run, finished_at: finishedAt.toISOString() };
  await store.record(reading);
  const status = createBackupStatus({ store, read: async () => reading });
  const get = await endpoint(t, status);
  let body = await (await get()).json();
  assert.equal(body.current, null);
  assert.equal(body.history[0].snapshot_id, 'abc');
  assert.equal(body.history[0].finished_at, finishedAt.toISOString());
  await status.poll();
  await status.poll();
  assert.equal(await prisma.backupRunSnapshot.count({ where: { finishedAt } }), 1);
  body = await (await get()).json();
  assert.equal(body.current.state, 'ok');
  assert.equal(body.history[0].bytes_added, 123);
});

test('storage failure returns safe 503 and polling retries persistence', async (t) => {
  const store = memoryStore();
  const record = store.record;
  store.record = async () => { throw new Error('private database connection'); };
  const status = createBackupStatus({ store, read: async () => run });
  const get = await endpoint(t, status);
  await assert.rejects(status.poll(), { message: 'Backup status unavailable' });
  assert.equal((await get()).status, 503);
  store.record = record;
  await status.poll();
  assert.equal((await (await get()).json()).history.length, 1);
  store.history = async () => { throw new Error('private database connection'); };
  const response = await get();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Backup status unavailable' });
});
