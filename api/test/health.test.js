const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

let server;
let baseUrl;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('GET /health returns 200 with status and uptime', async () => {
  const res = await fetch(`${baseUrl}/health`);

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(typeof body.uptime, 'number');
  assert.ok(body.uptime >= 0);
});

test('unknown routes return 404 JSON', async () => {
  const res = await fetch(`${baseUrl}/does-not-exist`);

  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Not found' });
});
