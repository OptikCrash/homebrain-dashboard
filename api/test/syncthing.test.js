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

const realV217 = require("./fixtures/syncthing-v2.1.7/db-status.json");
test("genuine v2.1.7 db/status retains both configured folders", async () => {
  assert.ok(Object.hasOwn(realV217, "needTotalItems"));
  assert.equal(Object.hasOwn(realV217, "needItems"), false);
  const result = await readSyncthingStatus({ ...config, fetch: client({ notes: realV217, photos: realV217 }) });
  assert.deepEqual(result.folders, ["notes", "photos"].map((id) => ({ id, state: "idle", errors: 0, needItems: 0, needBytes: 0 })));
  assert.equal(result.error, undefined);
});

// Derived from the real response; these are synthetic validation/health cases, not captures.
test('derived pending totals include directories, symlinks and deletions', async () => {
  const notes = { ...realV217, state: 'syncing', needFiles: 0, needDirectories: 2,
    needSymlinks: 3, needDeletes: 4, needTotalItems: 9, needBytes: 400, errors: 2 };
  const result = await readSyncthingStatus({ ...config, fetch: client({ notes }) });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.folders[0], { id: 'notes', state: 'syncing', errors: 2, needItems: 9, needBytes: 400 });
});

test('modern fields take precedence over conflicting legacy aliases', async () => {
  const notes = { ...realV217, needTotalItems: 3, needItems: 99, errors: 2, pullErrors: 99 };
  const result = await readSyncthingStatus({ ...config, fetch: client({ notes }) });
  assert.equal(result.error, undefined);
  assert.equal(result.folders[0].needItems, 3);
  assert.equal(result.folders[0].errors, 2);
});

test('derived missing or invalid counters fail per folder without fallback or zero defaults', async () => {
  for (const field of ['needTotalItems', 'needBytes', 'errors']) {
    for (const value of [undefined, null, -1, '0', 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      const notes = { ...realV217, [field]: value, needItems: 0, pullErrors: 0 };
      const result = await readSyncthingStatus({ ...config, fetch: client({ notes, photos: realV217 }) });
      assert.equal(result.error, 'Invalid Syncthing db/status response', `${field}: ${value}`);
      assert.deepEqual(result.folders, [{ id: 'photos', state: 'idle', errors: 0, needItems: 0, needBytes: 0 }]);
    }
  }
  for (const field of ['needTotalItems', 'needBytes', 'errors']) {
    const notes = { ...realV217 };
    delete notes[field];
    if (field === 'errors') delete notes.pullErrors;
    const result = await readSyncthingStatus({ ...config, fetch: client({ notes }) });
    assert.equal(result.error, 'Invalid Syncthing db/status response');
  }
});

test('derived valid maximum counters retain precision', async () => {
  const notes = { ...realV217, needTotalItems: Number.MAX_SAFE_INTEGER,
    needBytes: Number.MAX_SAFE_INTEGER, errors: Number.MAX_SAFE_INTEGER };
  const result = await readSyncthingStatus({ ...config, fetch: client({ notes }) });
  assert.equal(result.error, undefined);
  assert.equal(result.folders[0].needItems, Number.MAX_SAFE_INTEGER);
});

test('real response and derived pending/error cases retain status-service health classification', async () => {
  const { createSyncthingStatus } = require('../src/status/syncthing');
  for (const [changes, expected] of [
    [{}, 'healthy'], [{ needTotalItems: 1, needFiles: 0, needDirectories: 1 }, 'unhealthy'],
    [{ needTotalItems: 1, needFiles: 0, needSymlinks: 1 }, 'unhealthy'],
    [{ needTotalItems: 1, needFiles: 0, needDeletes: 1 }, 'unhealthy'],
    [{ errors: 1 }, 'unhealthy'], [{ needBytes: 1 }, 'unhealthy'],
    [{ needTotalItems: null }, 'unhealthy'],
  ]) {
    let saved;
    const status = createSyncthingStatus({ store: { record: async (row) => { saved = row; } },
      read: () => readSyncthingStatus({ ...config, fetch: client({ notes: { ...realV217, ...changes }, photos: realV217 }) }) });
    await status.poll();
    assert.equal(saved.status, expected, JSON.stringify(changes));
  }
});

test('modern zero totals and errors override nonzero aliases', async () => {
  const result = await readSyncthingStatus({ ...config, fetch: client({
    notes: { ...realV217, needItems: 99, pullErrors: 99 },
  }) });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.folders[0], { id: 'notes', state: 'idle', errors: 0, needItems: 0, needBytes: 0 });
});

test('folder requests remain sequential and bounded after deduplication', async () => {
  let requests = 0;
  let active = 0;
  const normal = client({ notes: realV217, photos: realV217 });
  const result = await readSyncthingStatus({ ...config, fetch: async (url, options) => {
    requests++;
    assert.equal(active++, 0);
    try { return await normal(url, options); } finally { active--; }
  } });
  assert.equal(requests, 4);
  assert.equal(result.error, undefined);
});

test('each endpoint has a five-second timeout and safe failure preserves later folders', async (t) => {
  t.mock.method(AbortSignal, 'timeout', (milliseconds) => {
    assert.equal(milliseconds, 5000);
    const controller = new AbortController();
    queueMicrotask(() => controller.abort(new Error(config.apiKey)));
    return controller.signal;
  });
  for (const endpoint of ['/rest/system/status', '/rest/system/connections', 'notes']) {
    const normal = client({ notes: realV217, photos: realV217 });
    const result = await readSyncthingStatus({ ...config, fetch: (url, options) => {
      const target = new URL(url);
      const key = target.searchParams.get('folder') || target.pathname;
      if (key !== endpoint) return normal(url, options);
      return new Promise((resolve, reject) => options.signal.addEventListener('abort',
        () => reject(options.signal.reason), { once: true }));
    } });
    assert.ok(result.error);
    assert.ok(!JSON.stringify(result).includes(config.apiKey));
    assert.equal(result.reachable, endpoint !== '/rest/system/status');
    if (result.reachable) assert.ok(result.folders.some((folder) => folder.id === 'photos'));
  }
});
