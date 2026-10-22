const REQUEST_TIMEOUT_MS = 5000;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// No logging or persistence. Never expose client exceptions or response bodies:
// either can contain the API key. All requests use a bounded timeout.
async function readSyncthingStatus({
  url = process.env.SYNCTHING_URL,
  apiKey = process.env.SYNCTHING_API_KEY,
  folders = process.env.SYNCTHING_FOLDERS || '',
  fetch: httpClient = globalThis.fetch,
} = {}) {
  const reading = { reachable: false, folders: [], error: undefined };
  const fail = (error) => ({ ...reading, error });
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)) {
    return fail('SYNCTHING_API_KEY is missing or invalid');
  }
  let base;
  try {
    base = new URL(url);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      return fail('SYNCTHING_URL must be an HTTP(S) URL without credentials, query or fragment');
    }
  } catch {
    return fail('SYNCTHING_URL is missing or invalid');
  }
  if (typeof folders !== 'string' || typeof httpClient !== 'function') {
    return fail('Invalid Syncthing reader configuration');
  }
  const ids = [...new Set(folders.split(',').map((id) => id.trim()).filter(Boolean))];
  const errors = [];
  async function get(endpoint, folder) {
    const target = new URL(`${base.toString().replace(/\/$/, '')}/rest/${endpoint}`);
    if (folder !== undefined) target.searchParams.set('folder', folder);
    try {
      const response = await httpClient(target.toString(), {
        method: 'GET', headers: { 'X-API-Key': apiKey },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error',
      });
      if (response.status !== 200) {
        errors.push(`Syncthing ${endpoint} request returned a non-200 response`);
        return null;
      }
      const data = await response.json();
      if (!isObject(data)) throw new Error();
      return data;
    } catch {
      errors.push(`Syncthing ${endpoint} request failed`);
      return null;
    }
  }
  if (!await get('system/status')) return fail(errors.join('; '));
  reading.reachable = true;
  const connections = await get('system/connections');
  if (connections) {
    if (!isObject(connections.connections) || Object.values(connections.connections).some(
      (connection) => !isObject(connection) || typeof connection.connected !== 'boolean',
    )) {
      errors.push('Invalid Syncthing system/connections response');
    } else {
      reading.connections = Object.fromEntries(Object.entries(connections.connections)
        .map(([id, connection]) => [id, { connected: connection.connected }]));
    }
  }
  for (const id of ids) {
    const data = await get('db/status', id);
    if (!data) continue;
    const errorCount = data.errors ?? data.pullErrors;
    if (typeof data.state !== 'string' || !data.state ||
        ![errorCount, data.needItems, data.needBytes].every((value) => Number.isSafeInteger(value) && value >= 0)) {
      errors.push('Invalid Syncthing db/status response');
      continue;
    }
    reading.folders.push({ id, state: data.state, errors: errorCount, needItems: data.needItems, needBytes: data.needBytes });
  }
  reading.error = errors.length ? errors.join('; ') : undefined;
  return reading;
}

module.exports = { readSyncthingStatus };
