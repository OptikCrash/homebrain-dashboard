const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readSyncthingStatus } = require('../src/checks/syncthing');
const config = { url: 'http://syncthing:8384/', apiKey: 'test-key', folders: ' notes, photos, notes, ' };
const synced = { state: 'idle', errors: 0, needItems: 0, needBytes: 0 };
function client(overrides = {}) {
  return async (url, options) => {
    const target = new URL(url);
    assert.equal(options.method, 'GET');
    assert.equal(options.headers['X-API-Key'], config.apiKey);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    const key = target.searchParams.get('folder') || target.pathname;
    const data = Object.hasOwn(overrides, key) ? overrides[key] : {
      '/rest/system/status': { uptime: 12 },
      '/rest/system/connections': { connections: { peer: { connected: true } } },
      notes: synced, photos: synced,
    }[key];
    if (data instanceof Error) throw data;
    return { status: 200, json: async () => data };
  };
}
test('synced folders, deduplicated IDs and connection state', async () => {
  assert.deepEqual(await readSyncthingStatus({ ...config, fetch: client() }), {
    reachable: true, error: undefined, connections: { peer: { connected: true } },
    folders: ['notes', 'photos'].map((id) => ({ id, ...synced })),
  });
});
test('out-of-sync folder retains state and error, item and byte counts', async () => {
  const result = await readSyncthingStatus({ ...config, fetch: client({ notes: {
    state: 'syncing', pullErrors: 2, needItems: 3, needBytes: 400,
  } }) });
  assert.equal(result.reachable, true);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.folders[0], { id: 'notes', state: 'syncing', errors: 2, needItems: 3, needBytes: 400 });
});
test('network errors are unreachable and exclude client error secrets', async () => {
  assert.deepEqual(await readSyncthingStatus({ ...config, fetch: client({ '/rest/system/status': new Error(config.apiKey) }) }),
    { reachable: false, folders: [], error: 'Syncthing system/status request failed' });
});
test('non-200 response is unreachable without consuming the response body', async () => {
  const result = await readSyncthingStatus({ ...config, fetch: async () => ({ status: 401 }) });
  assert.equal(result.reachable, false);
  assert.match(result.error, /non-200/);
});
test('missing key fails before HTTP', async () => {
  const result = await readSyncthingStatus({ ...config, apiKey: '', fetch: () => assert.fail('unexpected request') });
  assert.equal(result.reachable, false);
  assert.match(result.error, /SYNCTHING_API_KEY/);
});
test('later request failures preserve reachability and successful folders', async () => {
  const result = await readSyncthingStatus({ ...config, fetch: client({
    '/rest/system/connections': new Error(config.apiKey), notes: new Error(config.apiKey),
  }) });
  assert.equal(result.reachable, true);
  assert.deepEqual(result.folders, [{ id: 'photos', ...synced }]);
  assert.match(result.error, /system\/connections/);
  assert.match(result.error, /db\/status/);
  assert.ok(!JSON.stringify(result).includes(config.apiKey));
});
test('malformed folder responses cannot look synced', async () => {
  for (const notes of [null, {}, { ...synced, needItems: -1 }, { ...synced, errors: '0' }]) {
    const result = await readSyncthingStatus({ ...config, fetch: client({ notes }) });
    assert.ok(result.error);
    assert.deepEqual(result.folders.map((folder) => folder.id), ['photos']);
  }
});
test('folder IDs use query encoding', async () => {
  const id = 'notes & photos/#?';
  const result = await readSyncthingStatus({ ...config, folders: id, fetch: client({ [id]: synced }) });
  assert.equal(result.folders[0].id, id);
});
test('invalid configuration fails before HTTP', async () => {
  for (const override of [{ url: '' }, { url: 'file:///tmp/test' }, { url: 'http://user:pass@host' }, { folders: [] }]) {
    const result = await readSyncthingStatus({ ...config, ...override, fetch: () => assert.fail('unexpected request') });
    assert.equal(result.reachable, false);
    assert.ok(result.error);
  }
});
test('empty folder list checks only system endpoints', async () => {
  const result = await readSyncthingStatus({ ...config, folders: '', fetch: client() });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.folders, []);
});
test('malformed connection payload and JSON failures are safe errors', async () => {
  const result = await readSyncthingStatus({ ...config, fetch: client({ '/rest/system/connections': {} }) });
  assert.match(result.error, /Invalid Syncthing system\/connections/);
  const invalidJson = await readSyncthingStatus({ ...config, fetch: async () => ({
    status: 200, json: async () => { throw new Error(config.apiKey); },
  }) });
  assert.equal(invalidJson.reachable, false);
  assert.ok(!invalidJson.error.includes(config.apiKey));
});
test('non-200 folder response preserves other folder readings', async () => {
  const normal = client();
  const result = await readSyncthingStatus({ ...config, fetch: (url, options) =>
    new URL(url).searchParams.get('folder') === 'notes'
      ? Promise.resolve({ status: 503 }) : normal(url, options),
  });
  assert.equal(result.reachable, true);
  assert.match(result.error, /db\/status.*non-200/);
  assert.deepEqual(result.folders, [{ id: 'photos', ...synced }]);
});
