const REQUEST_TIMEOUT_MS = 5000;

async function readCouchdbStatus({
  url = process.env.COUCHDB_URL,
  fetch: httpClient = globalThis.fetch,
} = {}) {
  const fail = (error) => ({ reachable: false, error });
  let base;
  try {
    base = new URL(url);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      return fail('COUCHDB_URL must be an HTTP(S) URL without credentials, query or fragment');
    }
  } catch {
    return fail('COUCHDB_URL is missing or invalid');
  }
  if (typeof httpClient !== 'function') return fail('Invalid CouchDB reader configuration');

  // Never expose response bodies or client exceptions, which may contain secrets.
  for (const endpoint of ['/_up', '/']) {
    let status;
    try {
      const response = await httpClient(`${base.toString().replace(/\/$/, '')}${endpoint}`, {
        method: 'GET', credentials: 'omit', redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      status = response.status;
      // Only the status matters; release an unread body and its connection.
      if (response.body) await response.body.cancel();
    } catch {
      return fail(`CouchDB ${endpoint} request failed`);
    }
    if (status === 200 || status === 401) return { reachable: true, error: undefined };
    if (endpoint === '/_up' && status === 404) continue;
    return fail(`CouchDB ${endpoint} request returned an unexpected status`);
  }
}

module.exports = { readCouchdbStatus };
