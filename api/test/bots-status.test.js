const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { readAllBotHealth, STALE_AFTER_MS } = require('../src/checks/bots');
const { createBotsStatus } = require('../src/status/bots');

const now = Date.parse('2026-10-23T12:00:00Z');
const health = (name, age = 0) => ({
  name, checked_at: new Date(now - age).toISOString(), container: 'running',
  container_started_at: null, api: 'up', readiness: 'ok',
  last_message_at: null, last_reply_at: null,
});

async function fixture(t) {
  const statusDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bots-status-'));
  t.after(() => fs.rm(statusDir, { recursive: true, force: true }));
  const botsStatus = createBotsStatus({ read: () => readAllBotHealth({ statusDir, now }) });
  const server = createApp({ botsStatus }).listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    statusDir,
    write: (bot, value) => fs.writeFile(path.join(statusDir, `${bot}.json`), JSON.stringify(value)),
    async get() {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/status/bots`);
      return { status: response.status, body: await response.json() };
    },
  };
}

test('endpoint returns both sanitized bots and reads file changes on every request', async (t) => {
  const { write, get } = await fixture(t);
  await write('chopper', { ...health('Chopper'), message: 'private', log: '/private/log' });
  await write('ap5', health('AP-5'));
  assert.deepEqual(await get(), { status: 200, body: { bots: [
    { bot: 'chopper', present: true, ...health('Chopper'), stale: false },
    { bot: 'ap5', present: true, ...health('AP-5'), stale: false },
  ] } });
  await write('ap5', { ...health('AP-5'), api: 'down', readiness: 'ok' });
  const { body } = await get();
  assert.equal(body.bots[1].api, 'down');
  assert.equal(body.bots[1].readiness, null);
});

for (const missing of [['chopper'], ['ap5'], ['chopper', 'ap5']]) {
  test(`endpoint tolerates missing files: ${missing.join(', ')}`, async (t) => {
    const { write, get } = await fixture(t);
    for (const bot of ['chopper', 'ap5']) {
      if (!missing.includes(bot)) await write(bot, health(bot));
    }
    const { status, body } = await get();
    assert.equal(status, 200);
    assert.deepEqual(body.bots, ['chopper', 'ap5'].map((bot) => missing.includes(bot)
      ? { bot, present: false }
      : { bot, present: true, ...health(bot), stale: false }));
  });
}

for (const ages of [[STALE_AFTER_MS + 1, 0], [0, STALE_AFTER_MS + 1], [STALE_AFTER_MS + 1, STALE_AFTER_MS + 1]]) {
  test(`endpoint applies staleness independently for ages ${ages}`, async (t) => {
    const { write, get } = await fixture(t);
    await write('chopper', health('Chopper', ages[0]));
    await write('ap5', health('AP-5', ages[1]));
    const { status, body } = await get();
    assert.equal(status, 200);
    assert.deepEqual(body.bots.map((bot) => bot.stale), ages.map((age) => age > STALE_AFTER_MS));
  });
}

test('endpoint tolerates malformed files and masks unexpected read failures, then recovers', async (t) => {
  const { statusDir, write, get } = await fixture(t);
  const file = path.join(statusDir, 'chopper.json');
  await fs.writeFile(file, '{private malformed data');
  await write('ap5', health('AP-5'));
  let result = await get();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.bots[0], { bot: 'chopper', present: false });
  assert.equal(result.body.bots[1].present, true);
  await fs.unlink(file);
  await fs.mkdir(file);
  assert.deepEqual(await get(), { status: 503, body: { error: 'Bot status unavailable' } });
  await fs.rmdir(file);
  await write('chopper', health('Chopper'));
  result = await get();
  assert.equal(result.status, 200);
  assert.ok(result.body.bots.every((bot) => bot.present));
});
