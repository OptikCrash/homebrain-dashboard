const { test } = require('node:test');
const assert = require('node:assert/strict');
const { port, reserve } = require('../src/listen');

test('PORT defaults and invalid inputs fail clearly', () => {
  assert.equal(port('8090'), 8090);
  for (const value of ['', '0', '-1', '65536', '80.5', 'abc', ' 8090', '1e3']) {
    assert.throws(() => port(value), /PORT must be an integer between 1 and 65535/);
  }
});

test('reservation binds only loopback and rejects an occupied port without disturbing it', async () => {
  const socket = await reserve(0);
  try {
    assert.equal(socket.address().address, '127.0.0.1');
    await assert.rejects(reserve(socket.address().port), /unavailable; free the port/);
    assert.equal(socket.listening, true);
  } finally {
    await new Promise(resolve => socket.close(resolve));
  }
});

test('released port can be reserved again', async () => {
  const first = await reserve(0);
  const value = first.address().port;
  await new Promise(resolve => first.close(resolve));
  const second = await reserve(value);
  await new Promise(resolve => second.close(resolve));
});

test('Postgres preflight rejects occupied ports without contacting them, and permits free ports', async () => {
  const { execFile } = require('node:child_process');
  const exec = require('node:util').promisify(execFile);
  const path = require('node:path');
  const socket = await reserve(0);
  const value = socket.address().port;
  let contacts = 0;
  socket.on('connection', connection => { contacts++; connection.destroy(); });
  const args = ['-c', 'from port_check import check_port; import sys; check_port(int(sys.argv[1]))', String(value)];
  const options = { cwd: path.resolve(__dirname, '../../postgres'), env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } };
  try {
    await assert.rejects(exec('python3', args, options), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /is unavailable; free the port or stop the other listener/);
      return true;
    });
    assert.equal(contacts, 0);
    assert.equal(socket.listening, true);
  } finally {
    await new Promise(resolve => socket.close(resolve));
  }
  await exec('python3', args, options);
});

test('container startup fails before migrations when the API port is occupied', async () => {
  const socket = await reserve(0);
  const exec = require('node:util').promisify(require('node:child_process').execFile);
  try {
    await assert.rejects(exec(process.execPath, [require('node:path').resolve(__dirname, '../src/start.js')], {
      env: { ...process.env, PORT: String(socket.address().port) },
    }), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /is unavailable; free the port/);
      assert.doesNotMatch(error.stdout, /Prisma|migration/);
      return true;
    });
    assert.equal(socket.listening, true);
  } finally {
    await new Promise(resolve => socket.close(resolve));
  }
});
