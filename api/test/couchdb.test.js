const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readCouchdbStatus } = require('../src/checks/couchdb');
const url = 'http://127.0.0.1:5984/';

for (const status of [200, 401]) {
  test(`${status} is reachable with an unauthenticated GET`, async () => {
    let cancelled = false;
    const result = await readCouchdbStatus({ url, fetch: async (target, options) => {
      assert.equal(target, `${url}_up`);
      assert.equal(options.method, 'GET');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.headers, undefined);
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      return { status, body: { cancel: async () => { cancelled = true; } } };
    } });
    assert.deepEqual(result, { reachable: true, error: undefined });
    assert.equal(cancelled, true);
  });
}

test('unexpected statuses are unreachable without fallback or response body parsing', async () => {
  for (const status of [201, 302, 403, 500, 503]) {
    let calls = 0;
    const result = await readCouchdbStatus({ url, fetch: async () => {
      calls++;
      return { status, json: () => assert.fail('unexpected body parsing') };
    } });
    assert.equal(result.reachable, false);
    assert.match(result.error, /unexpected status/);
    assert.equal(calls, 1);
  }
});

test('missing /_up falls back to the base root and normalizes its result', async () => {
  for (const status of [200, 401, 404, 503]) {
    const targets = [];
    const result = await readCouchdbStatus({ url: `${url}prefix/`, fetch: async (target) => {
      targets.push(target);
      return { status: targets.length === 1 ? 404 : status };
    } });
    assert.deepEqual(targets, [`${url}prefix/_up`, `${url}prefix/`]);
    assert.equal(result.reachable, status === 200 || status === 401);
    assert.equal(Boolean(result.error), !result.reachable);
  }
});

test('network failures on either endpoint return safe errors', async () => {
  for (const fallback of [false, true]) {
    let calls = 0;
    const result = await readCouchdbStatus({ url, fetch: async () => {
      if (fallback && calls++ === 0) return { status: 404 };
      throw new Error('sensitive client details');
    } });
    assert.equal(result.reachable, false);
    assert.match(result.error, /request failed/);
    assert.ok(!result.error.includes('sensitive'));
  }
});

test('request timeout aborts the client and returns unreachable', async (t) => {
  t.mock.method(AbortSignal, 'timeout', (milliseconds) => {
    assert.equal(milliseconds, 5000);
    const controller = new AbortController();
    queueMicrotask(() => controller.abort());
    return controller.signal;
  });
  const result = await readCouchdbStatus({ url, fetch: async (_, { signal }) =>
    new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
  });
  assert.deepEqual(result, { reachable: false, error: 'CouchDB /_up request failed' });
});

test('invalid configuration fails before HTTP without exposing credentials', async () => {
  for (const invalid of ['', 'invalid', 'file:///tmp/db', 'http://user:secret@localhost',
    `${url}?secret=value`, `${url}#secret`]) {
    const result = await readCouchdbStatus({ url: invalid, fetch: () => assert.fail('unexpected HTTP') });
    assert.equal(result.reachable, false);
    assert.match(result.error, /COUCHDB_URL/);
    assert.ok(!result.error.includes('secret'));
  }
  assert.equal((await readCouchdbStatus({ url, fetch: null })).reachable, false);
});

test('URL defaults to COUCHDB_URL', async (t) => {
  const previous = process.env.COUCHDB_URL;
  process.env.COUCHDB_URL = url;
  t.after(() => {
    if (previous === undefined) delete process.env.COUCHDB_URL;
    else process.env.COUCHDB_URL = previous;
  });
  assert.equal((await readCouchdbStatus({ fetch: async (target) => {
    assert.equal(target, `${url}_up`);
    return { status: 200 };
  } })).reachable, true);
});
