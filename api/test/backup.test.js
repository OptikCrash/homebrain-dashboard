const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm, mkdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { readBackupStatus, isBackupStale, isNewCompletedRun } = require('../src/checks/backup');

const finished = '2026-10-23T03:15:00Z';
const run = {
  state: 'ok', started_at: '2026-10-23T03:00:00Z', finished_at: finished,
  last_success: finished, error: null, snapshot_id: 'abc123',
  files_total: 100, bytes_total: 2048, bytes_added: 512, duration_s: 900.5,
};
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'backup-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, file: path.join(dir, 'backup.json') };
}

test('missing file or directory means no backup yet', async (t) => {
  const { dir } = await fixture(t);
  assert.equal(await readBackupStatus({ dir }), null);
  assert.equal(await readBackupStatus({ dir: path.join(dir, 'missing') }), null);
});

for (const state of ['ok', 'failed', 'skipped']) {
  test(`reads ${state} run and only exposes known fields`, async (t) => {
    const { dir, file } = await fixture(t);
    const data = { ...run, state, error: state === 'ok' ? null : 'Backup did not complete' };
    await writeFile(file, JSON.stringify({ ...data, extra: 'omit', previous: run }));
    assert.deepEqual(await readBackupStatus({ dir }), { ...data, previous: null });
  });
}

test('running carries a normalized previous result and nullable metrics', async (t) => {
  const { dir, file } = await fixture(t);
  await writeFile(file, JSON.stringify({ state: 'running', started_at: run.started_at,
    last_success: finished, previous: { state: 'ok', finished_at: finished, snapshot_id: 'old', bytes_added: 12 } }));
  const result = await readBackupStatus({ dir });
  assert.equal(result.finished_at, null);
  assert.equal(result.bytes_total, null);
  assert.equal(result.previous.state, 'ok');
  assert.equal(result.previous.snapshot_id, 'old');
  assert.equal(result.previous.bytes_added, 12);
  assert.equal(isNewCompletedRun(result), false);
});

test('invalid JSON and malformed fields fail with a safe error', async (t) => {
  const { dir, file } = await fixture(t);
  const invalid = [null, [], {}, { ...run, state: 'unknown' },
    { ...run, finished_at: null }, { ...run, last_success: 'yesterday' },
    { ...run, files_total: -1 }, { ...run, bytes_total: '123' },
    { ...run, files_total: 1.5 }, { ...run, duration_s: -1 },
    { ...run, error: {} }, { ...run, snapshot_id: 123 },
    { ...run, state: 'running' },
    { state: 'running', previous: { state: 'running' } }];
  for (const data of invalid) {
    await writeFile(file, JSON.stringify(data));
    await assert.rejects(readBackupStatus({ dir }), { message: 'Invalid backup status' });
  }
  await writeFile(file, '{sensitive malformed contents');
  await assert.rejects(readBackupStatus({ dir }), { message: 'Invalid backup status' });
});

test('read failures are distinct from missing backups', async (t) => {
  const { dir, file } = await fixture(t);
  await mkdir(file);
  await assert.rejects(readBackupStatus({ dir }), { message: 'Backup status unavailable' });
});

test('reader defaults to HOST_STATUS_DIR', async (t) => {
  const { dir, file } = await fixture(t);
  const previous = process.env.HOST_STATUS_DIR;
  process.env.HOST_STATUS_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.HOST_STATUS_DIR;
    else process.env.HOST_STATUS_DIR = previous;
  });
  await writeFile(file, JSON.stringify(run));
  assert.equal((await readBackupStatus()).state, 'ok');
});

test('staleness uses a strict 26-hour boundary', () => {
  const boundary = Date.parse(finished) + 26 * 60 * 60 * 1000;
  assert.equal(isBackupStale(finished, boundary + 1), true);
  assert.equal(isBackupStale(finished, boundary), false);
  assert.equal(isBackupStale(finished, new Date(boundary - 1)), false);
  assert.equal(isBackupStale(finished, Date.parse(finished) - 1), false);
  for (const missing of [null, undefined, 'invalid']) assert.equal(isBackupStale(missing, boundary), false);
});

test('completion detection rejects duplicates, older, running and invalid timestamps', () => {
  for (const state of ['ok', 'failed', 'skipped']) {
    const completed = { ...run, state };
    assert.equal(isNewCompletedRun(completed), true);
    assert.equal(isNewCompletedRun(completed, '2026-10-22T03:15:00Z'), true);
    assert.equal(isNewCompletedRun(completed, finished), false);
    assert.equal(isNewCompletedRun(completed, new Date(finished)), false);
    assert.equal(isNewCompletedRun(completed, '2026-10-24T03:15:00Z'), false);
    assert.equal(isNewCompletedRun(completed, 'invalid'), false);
  }
  for (const value of [null, { ...run, state: 'running' }, { ...run, finished_at: null },
    { ...run, finished_at: 'invalid' }]) assert.equal(isNewCompletedRun(value), false);
});
