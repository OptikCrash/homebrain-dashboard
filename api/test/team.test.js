const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readTeamRoster, readTeamInstances } = require('../src/checks/team');
const { createTeamStatus } = require('../src/status/team');
const { createApp } = require('../src/app');

async function fixture(t) {
  const statusDir = await fs.mkdtemp(path.join(os.tmpdir(), 'team-'));
  t.after(() => fs.rm(statusDir, { recursive: true, force: true }));
  const write = (file, value) => fs.writeFile(path.join(statusDir, file), JSON.stringify(value));
  const members = [{ name: 'Zeb', title: 'backend', engine: 'codex' }, { name: 'Sabine', title: 'frontend' }];
  await write('roles.json', members);
  const status = createTeamStatus({ roster: () => readTeamRoster({ statusDir }), instances: () => readTeamInstances({ statusDir }) });
  return { statusDir, write, members, status };
}
const job = (name, phase = 'building', updated_at = '2026-10-22T18:00:00Z') =>
  ({ name, instance: 'issue-23-zeb', title: 'backend', issue: 23, pr: null, phase, result: '', updated_at });

test('readers preserve roster and parsed instances, skipping unrelated, malformed and unreadable files', async (t) => {
  const { statusDir, write, members } = await fixture(t);
  await write('Zeb-1.json', job('Zeb'));
  await write('ignored.json', job('Ignored'));
  await fs.writeFile(path.join(statusDir, 'Sabine-1.json'), '{');
  await write('Zeb-2.json', null);
  await write('Zeb-3.json', { name: 'Zeb', phase: 'invalid' });
  await fs.symlink(path.join(statusDir, 'absent'), path.join(statusDir, 'Zeb-4.json'));
  assert.deepEqual(await readTeamRoster({ statusDir }), members);
  assert.deepEqual(await readTeamInstances({ statusDir }), [job('Zeb')]);
});

test('missing directory is empty; malformed roster and unexpected directory errors propagate', async (t) => {
  const { statusDir } = await fixture(t);
  const missing = path.join(statusDir, 'missing');
  assert.deepEqual(await readTeamRoster({ statusDir: missing }), []);
  assert.deepEqual(await readTeamInstances({ statusDir: missing }), []);
  await fs.writeFile(path.join(statusDir, 'roles.json'), '{');
  await assert.rejects(readTeamRoster({ statusDir }), SyntaxError);
  await fs.writeFile(path.join(statusDir, 'roles.json'), '{}');
  await assert.rejects(readTeamRoster({ statusDir }), TypeError);
  await assert.rejects(readTeamInstances({ statusDir: path.join(statusDir, 'roles.json') }), { code: 'ENOTDIR' });
});

test('idle roster, active work, terminal retention and numeric supersession read fresh on each call', async (t) => {
  const { status, write, members } = await fixture(t);
  assert.deepEqual(await status.getStatus(), { roster: members.map((m) => ({ ...m, status: 'idle' })), active: [], recent: [] });
  await write('Zeb-9.json', job('Zeb'));
  let result = await status.getStatus();
  assert.deepEqual(result.roster.map((m) => m.status), ['active', 'idle']);
  assert.deepEqual(result.active, [job('Zeb')]);
  await write('Zeb-9.json', job('Zeb', 'done'));
  result = await status.getStatus();
  assert.equal(result.active[0].phase, 'done');
  assert.equal(result.roster[0].status, 'idle');
  await write('Zeb-10.json', job('Zeb', 'starting', '2026-10-21T00:00:00Z'));
  result = await status.getStatus();
  assert.equal(result.active.length, 1);
  assert.equal(result.active[0].phase, 'starting');
  assert.equal(result.roster[0].status, 'active');
  assert.equal(result.recent[0].phase, 'done');
});

test('recent includes all terminal phases and teammates, capped at five newest timestamps', async (t) => {
  const { status, write } = await fixture(t);
  const phases = ['done', 'failed', 'no-changes', 'stopped'];
  for (let i = 1; i <= 8; i++) {
    const name = i % 2 ? 'Zeb' : 'Sabine';
    await write(`${name}-${i}.json`, job(name, phases[i % 4], `2026-10-22T18:0${i}:00Z`));
  }
  await write('Zeb-99.json', job('Zeb', 'reviewing', '2026-10-22T19:00:00Z'));
  const { recent, active } = await status.getStatus();
  assert.equal(active.length, 2);
  assert.equal(recent.length, 5);
  assert.deepEqual(recent.map((r) => r.updated_at), [8, 7, 6, 5, 4].map((i) => `2026-10-22T18:0${i}:00Z`));
  assert.deepEqual(Object.keys(recent[0]), ['name', 'title', 'issue', 'pr', 'phase', 'result', 'updated_at']);
});

test('missing roster preserves live work and orders large instance numbers exactly', async (t) => {
  const { statusDir, status, write } = await fixture(t);
  await fs.unlink(path.join(statusDir, 'roles.json'));
  // These adjacent numbers compare equal if converted to JavaScript Number.
  await write('Zeb-9007199254740992.json', job('Zeb', 'done'));
  await write('Zeb-9007199254740993.json', job('Zeb', 'reviewing'));
  const result = await status.getStatus();
  assert.deepEqual(result.roster, []);
  assert.deepEqual(result.active, [job('Zeb', 'reviewing')]);
  assert.equal(result.recent.length, 1);
  assert.equal(result.recent[0].phase, 'done');
  // Internal filename metadata must never leak or break JSON serialization.
  assert.deepEqual(JSON.parse(JSON.stringify(result)).active, result.active);
});

test('endpoint masks roster failures and recovers after the roster is repaired', async (t) => {
  const { statusDir, status, write, members } = await fixture(t);
  const server = createApp({ teamStatus: status }).listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/team/status`;
  for (const contents of ['private malformed roster', '{}', '[null]', '["Zeb"]', '[[]]', '[{}]', '[{"name":23}]', '[{"name":" "}]']) {
    await fs.writeFile(path.join(statusDir, 'roles.json'), contents);
    const response = await fetch(url);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Team status unavailable' });
  }
  await write('roles.json', members);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    roster: members.map((member) => ({ ...member, status: 'idle' })),
    active: [], recent: [],
  });
});

test('endpoint skips bad instances, tolerates missing directory, removes old route and masks errors', async (t) => {
  const { statusDir, status, write } = await fixture(t);
  await write('Zeb-1.json', job('Zeb'));
  await fs.writeFile(path.join(statusDir, 'Zeb-2.json'), '{');
  await fs.symlink(path.join(statusDir, 'missing'), path.join(statusDir, 'Sabine-1.json'));
  const server = createApp({ teamStatus: status }).listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(`${base}/api/team/status`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).active.length, 1);
  assert.equal((await fetch(`${base}/api/status/builders`)).status, 404);
  await fs.rm(statusDir, { recursive: true });
  response = await fetch(`${base}/api/team/status`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { roster: [], active: [], recent: [] });
  await fs.writeFile(statusDir, 'private details');
  response = await fetch(`${base}/api/team/status`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Team status unavailable' });
});


test('endpoint exposes only public active work fields', async (t) => {
  const { status, write } = await fixture(t);
  const publicJob = { ...job('Zeb'), engine: 'codex', kind: 'build',
    branch: 'issue-23-zeb', started_at: '2026-10-22T17:00:00Z' };
  await write('Zeb-1.json', { ...publicJob, pid: 1234,
    log: '/private/host/work.log', futurePrivateField: 'private' });
  const server = createApp({ teamStatus: status }).listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/team/status`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).active, [publicJob]);
});
