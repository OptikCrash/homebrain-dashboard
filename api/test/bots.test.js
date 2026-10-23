const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { isStale, readBotHealth, readAllBotHealth, STALE_AFTER_MS } = require('../src/checks/bots');

const now = Date.parse('2026-10-23T12:00:00Z');
const minutesAgo = (minutes) => new Date(now - minutes * 60 * 1000).toISOString();

async function fixture(t) {
  const statusDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bots-'));
  t.after(() => fs.rm(statusDir, { recursive: true, force: true }));
  const write = (bot, value) => fs.writeFile(path.join(statusDir, `${bot}.json`), JSON.stringify(value));
  return { statusDir, write };
}
const health = (name, overrides = {}) => ({
  name, checked_at: minutesAgo(1), container: 'running',
  container_started_at: '2026-10-22T08:00:00Z', api: 'up', readiness: 'ok',
  last_message_at: '2026-10-23T11:50:00Z', last_reply_at: '2026-10-23T11:51:00Z',
  ...overrides,
});

test('both files present are read with only schema fields and fresh status', async (t) => {
  const { statusDir, write } = await fixture(t);
  await write('chopper', { ...health('Chopper'), message: 'secret text', log: '/var/log/chopper.log' });
  await write('ap5', health('AP-5', { container: 'restarting', readiness: 'degraded' }));
  assert.deepEqual(await readAllBotHealth({ statusDir, now }), [
    { bot: 'chopper', present: true, ...health('Chopper'), stale: false },
    { bot: 'ap5', present: true, ...health('AP-5', { container: 'restarting', readiness: 'degraded' }), stale: false },
  ]);
});

test('a missing file is reported as not present without hiding the other bot', async (t) => {
  const { statusDir, write } = await fixture(t);
  await write('ap5', health('AP-5'));
  const [chopper, ap5] = await readAllBotHealth({ statusDir, now });
  assert.deepEqual(chopper, { bot: 'chopper', present: false });
  assert.equal(ap5.present, true);
  assert.deepEqual(await readAllBotHealth({ statusDir: path.join(statusDir, 'missing'), now }),
    [{ bot: 'chopper', present: false }, { bot: 'ap5', present: false }]);
});

test('api down keeps null readiness', async (t) => {
  const { statusDir, write } = await fixture(t);
  await write('chopper', health('Chopper', { container: 'exited', api: 'down', readiness: null }));
  const reading = await readBotHealth('chopper', { statusDir });
  assert.equal(reading.api, 'down');
  assert.equal(reading.readiness, null);
  assert.equal(reading.container, 'exited');
});

test('stale checked_at (>3min) is flagged, fresh is not', async (t) => {
  const { statusDir, write } = await fixture(t);
  await write('chopper', health('Chopper', { checked_at: minutesAgo(4) }));
  await write('ap5', health('AP-5', { checked_at: minutesAgo(2) }));
  const [chopper, ap5] = await readAllBotHealth({ statusDir, now });
  assert.equal(chopper.stale, true);
  assert.equal(ap5.stale, false);
  assert.equal(isStale(new Date(now - STALE_AFTER_MS).toISOString(), now), false);
  assert.equal(isStale(new Date(now - STALE_AFTER_MS - 1000).toISOString(), now), true);
  assert.equal(isStale(null, now), true);
  assert.equal(isStale('not a date', now), true);
});

test('malformed files read as not present; unexpected values become null', async (t) => {
  const { statusDir, write } = await fixture(t);
  await fs.writeFile(path.join(statusDir, 'chopper.json'), '{');
  await write('ap5', health('AP-5', { container: 'paused', api: 'sideways', last_reply_at: 'yesterday' }));
  const [chopper, ap5] = await readAllBotHealth({ statusDir, now });
  assert.deepEqual(chopper, { bot: 'chopper', present: false });
  assert.equal(ap5.container, null);
  assert.equal(ap5.api, null);
  assert.equal(ap5.readiness, null);
  assert.equal(ap5.last_reply_at, null);
  await write('ap5', [health('AP-5')]);
  assert.equal(await readBotHealth('ap5', { statusDir }), null);
  await assert.rejects(readBotHealth('chopper', { statusDir: path.join(statusDir, 'chopper.json') }), { code: 'ENOTDIR' });
});
