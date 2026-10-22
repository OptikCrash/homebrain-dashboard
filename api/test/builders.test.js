const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm, mkdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { readBuilderStatus } = require('../src/builders');

let logs;
beforeEach(async () => { logs = await mkdtemp(path.join(tmpdir(), 'builders-')); });
afterEach(async () => { await rm(logs, { recursive: true, force: true }); });

test('uses the container LOGS environment variable when no directory is passed', async () => {
  const previous = process.env.LOGS;
  process.env.LOGS = logs;
  try {
    await writeFile(path.join(logs, 'codex.pid'), '123\n');
    await writeFile(path.join(logs, 'codex.log'), 'working from mounted logs\n');
    assert.deepEqual((await readBuilderStatus()).find((builder) => builder.name === 'codex'), {
      name: 'codex', status: 'running', lastLogLine: 'working from mounted logs',
    });
  } finally {
    if (previous === undefined) delete process.env.LOGS;
    else process.env.LOGS = previous;
  }
});

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

test('discovers additional builders and retains idle builders from old logs', async () => {
  await writeFile(path.join(logs, 'other.pid'), '456');
  await writeFile(path.join(logs, 'other.log'), 'busy\n');
  await writeFile(path.join(logs, 'retired.log'), 'finished\n');
  await mkdir(path.join(logs, 'directory.pid'));
  await writeFile(path.join(logs, 'ignored.txt'), 'unrelated');
  const statuses = await readBuilderStatus(logs);
  assert.deepEqual(statuses.map((b) => b.name), ['claude', 'codex', 'other', 'retired']);
  assert.deepEqual(statuses[2], { name: 'other', status: 'running', lastLogLine: 'busy' });
  assert.deepEqual(statuses[3], { name: 'retired', status: 'idle', lastLogLine: null });
  await rm(path.join(logs, 'other.pid'));
  assert.deepEqual((await readBuilderStatus(logs))[2], {
    name: 'other', status: 'idle', lastLogLine: null,
  });
});

test('caps huge newline-free logs and preserves UTF-8 at the boundary', async () => {
  await writeFile(path.join(logs, 'codex.pid'), '123');
  await writeFile(path.join(logs, 'codex.log'), '€'.repeat(100000));
  assert.equal((await readBuilderStatus(logs))[1].lastLogLine, '€'.repeat(21845));
});

test('reads a short last line after huge log content', async () => {
  await writeFile(path.join(logs, 'codex.pid'), '123');
  await writeFile(path.join(logs, 'codex.log'), `${'x'.repeat(1000000)}\nworking\n`);
  assert.equal((await readBuilderStatus(logs))[1].lastLogLine, 'working');
});
