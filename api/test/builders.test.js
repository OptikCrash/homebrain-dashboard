const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm, mkdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { readBuilderStatus } = require('../src/builders');

let logs;
beforeEach(async () => { logs = await mkdtemp(path.join(tmpdir(), 'builders-')); });
afterEach(async () => { await rm(logs, { recursive: true, force: true }); });

test('both known builders are idle without pid files, ignoring old logs', async () => {
  await writeFile(path.join(logs, 'claude.log'), 'old activity\n');
  assert.deepEqual(await readBuilderStatus(logs), [
    { name: 'claude', status: 'idle', lastLogLine: null },
    { name: 'codex', status: 'idle', lastLogLine: null },
  ]);
});

test('dummy host pid files report running and each builder gets its own last line', async () => {
  for (const name of ['claude', 'codex']) {
    await writeFile(path.join(logs, `${name}.pid`), '99999999\n');
    await writeFile(path.join(logs, `${name}.log`), `starting\n${name} working\n`);
  }
  assert.deepEqual(await readBuilderStatus(logs), ['claude', 'codex'].map((name) => ({
    name, status: 'running', lastLogLine: `${name} working`,
  })));
});

for (const [label, content, expected] of [
  ['no trailing newline', 'first\nworking', 'working'],
  ['CRLF', 'first\r\nworking\r\n', 'working'],
  ['empty log', '', null],
  ['blank last line', 'first\n\n', null],
  ['long UTF-8 line', `first\n${'é'.repeat(5000)}\n`, 'é'.repeat(5000)],
]) {
  test(`reads ${label}`, async () => {
    await writeFile(path.join(logs, 'codex.pid'), '123');
    await writeFile(path.join(logs, 'codex.log'), content);
    assert.equal((await readBuilderStatus(logs))[1].lastLogLine, expected);
  });
}

test('missing log does not hide a running builder', async () => {
  await writeFile(path.join(logs, 'claude.pid'), '123');
  assert.deepEqual((await readBuilderStatus(logs))[0], {
    name: 'claude', status: 'running', lastLogLine: null,
  });
});

test('missing logs directory reports idle', async () => {
  assert.ok((await readBuilderStatus(path.join(logs, 'missing'))).every((b) => b.status === 'idle'));
});

test('unexpected filesystem errors are surfaced', async () => {
  await writeFile(path.join(logs, 'claude.pid'), '123');
  await mkdir(path.join(logs, 'claude.log'));
  await assert.rejects(readBuilderStatus(logs), { code: 'EISDIR' });
});
