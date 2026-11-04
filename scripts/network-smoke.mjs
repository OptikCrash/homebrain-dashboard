// CI-only Docker integration. Every volume belongs to a fresh random test project.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);
const ports = [8080, 8090, 5434, 8384, 5984];
const listen = (server, port) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});
const close = server => new Promise(resolve => server.close(resolve));
// Refuse to run beside anything already on these ports; never stop or contact it.
for (const port of ports) {
  const probe = createServer();
  try {
    await listen(probe, port);
  } catch {
    console.error(`Smoke test needs 127.0.0.1:${port} free; another listener holds it. Nothing was started or stopped.`);
    process.exit(1);
  }
  await close(probe);
}
const directory = await mkdtemp(join(tmpdir(), 'dashboard-smoke-'));
// Malformed roster: /api/team/status answers 503, used to check non-200 passthrough.
await chmod(directory, 0o755);
await writeFile(join(directory, 'roles.json'), '{}', { mode: 0o644 });
const project = `dashboard-smoke-${process.pid}-${Date.now()}`;
const env = {
  ...process.env,
  // Throwaway credentials for this isolated CI database, never deployment credentials.
  POSTGRES_USER: 'smoke', POSTGRES_PASSWORD: 'smoke', POSTGRES_DB: 'smoke',
  TEAM_STATUS_DIR: directory, HOST_STATUS_DIR: directory,
  SYNCTHING_URL: 'http://127.0.0.1:8384', SYNCTHING_API_KEY: 'fixture',
  COUCHDB_URL: 'http://127.0.0.1:5984',
};
const args = ['compose', '--env-file', '/dev/null', '-p', project, '-f', 'docker-compose.yml'];
const compose = (...more) => exec('docker', [...args, ...more], { env, timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
const syncthing = httpServer((req, res) => {
  assert.equal(req.headers['x-api-key'], 'fixture');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(req.url.includes('connections') ? { connections: {} } : {}));
});
const couchdb = httpServer((req, res) => {
  assert.equal(req.headers.authorization, undefined);
  res.writeHead(401).end();
});
try {
  await listen(syncthing, 8384);
  await listen(couchdb, 5984);
  await compose('config', '--quiet');
  await compose('build');
  for (const port of [5434, 8090, 8080]) {
    let contacts = 0;
    const standin = createServer(socket => { contacts++; socket.destroy(); });
    await listen(standin, port);
    try {
      await assert.rejects(compose('up', '-d'), /Command failed/);
      assert.equal(standin.listening, true);
      assert.equal(contacts, 0, 'startup must not contact the unrelated listener');
      const logs = await compose('logs', '--no-color');
      assert.match(logs.stdout + logs.stderr, new RegExp(`${port}.*(unavailable|free|listener)`));
      if (port === 5434) assert.doesNotMatch(logs.stdout + logs.stderr, /prisma migrate|Applying migration/);
    } finally {
      await close(standin);
      await compose('down', '--volumes');
    }
  }
  await compose('up', '-d');
  await compose('up', '-d');
  const health = await fetch('http://127.0.0.1:8090/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  const migrations = await compose('exec', '-T', 'postgres', 'psql', '-h', '/var/run/postgresql', '-p', '5434', '-U', 'smoke', '-d', 'smoke', '-Atc', 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL');
  assert.ok(Number(migrations.stdout.trim()) > 0);
  const sql = query => compose('exec', '-T', 'postgres', 'psql', '-h', '/var/run/postgresql', '-p', '5434', '-U', 'smoke', '-d', 'smoke', '-Atc', query);
  assert.equal((await sql('SHOW listen_addresses')).stdout.trim(), '127.0.0.1');
  assert.equal((await sql('SHOW port')).stdout.trim(), '5434');
  await sql("INSERT INTO status_snapshots (service, status) VALUES ('preserved-smoke', 'healthy')");
  // TCP must reject the wrong password, including after reusing initialized data.
  const checkPassword = async () => {
    const rules = await sql('SELECT rule_number, type, address, auth_method, error FROM pg_hba_file_rules ORDER BY rule_number');
    console.log('Effective ordered HBA rules:', rules.stdout);
    const correct = await compose('exec', '-T', '-e', 'PGPASSWORD=smoke', 'postgres', 'psql', '-X', '-w', '-h', '127.0.0.1', '-p', '5434', '-U', 'smoke', '-d', 'smoke', '-Atc', 'SELECT 1');
    assert.equal(correct.stdout.trim(), '1');
    await assert.rejects(compose('exec', '-T', '-e', 'PGPASSWORD=wrong-fixture', 'postgres', 'psql', '-X', '-w', '-h', '127.0.0.1', '-p', '5434', '-U', 'smoke', '-d', 'smoke', '-c', 'SELECT 1'), error => {
      assert.match(error.stderr, /password authentication failed for user "smoke"/);
      return true;
    });
  };
  await checkPassword();
  await compose('restart', 'postgres');
  await compose('up', '-d', '--wait', '--wait-timeout', '120', 'postgres');
  await compose('restart', 'api');
  await compose('restart', 'web');
  await compose('up', '-d', '--wait', '--wait-timeout', '120');
  await compose('up', '-d');
  await checkPassword();
  assert.equal((await fetch('http://127.0.0.1:8090/health')).status, 200);
  assert.equal((await sql("SELECT count(*) FROM status_snapshots WHERE service='preserved-smoke'")).stdout.trim(), '1');
  let healthy = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    healthy = Number((await sql("SELECT count(DISTINCT service) FROM status_snapshots WHERE service IN ('syncthing', 'couchdb') AND status='healthy'")).stdout.trim());
    if (healthy === 2) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(healthy, 2, 'loopback fixtures must both produce healthy history');

  // Production web: HTML, hashed assets, UI-only SPA fallback and the same-origin /api proxy.
  const web = 'http://127.0.0.1:8080';
  const page = await fetch(`${web}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  const html = await page.text();
  assert.match(html, /<app-root/);
  const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => match[1]);
  assert.ok(assets.some(asset => asset.endsWith('.js')), 'index.html must reference the production bundle');
  for (const asset of assets) {
    const response = await fetch(new URL(asset, `${web}/`));
    assert.equal(response.status, 200, asset);
    assert.match(response.headers.get('content-type'), asset.endsWith('.js') ? /javascript/ : /text\/css/);
  }
  const route = await fetch(`${web}/some/ui/route`);
  assert.equal(route.status, 200);
  assert.equal(await route.text(), html);
  const missing = await fetch(`${web}/missing-file.js`);
  assert.equal(missing.status, 404);
  assert.doesNotMatch(await missing.text(), /<app-root/);
  // Proxied responses match the API's own status, content type and body.
  const same = async (path, status) => {
    const [direct, proxied] = await Promise.all([fetch(`http://127.0.0.1:8090${path}`), fetch(`${web}${path}`)]);
    assert.equal(direct.status, status, path);
    assert.equal(proxied.status, status, path);
    assert.equal(proxied.headers.get('content-type'), direct.headers.get('content-type'), path);
    return [await direct.text(), await proxied.text()];
  };
  const [couchDirect, couchProxied] = await same('/api/status/couchdb', 200);
  assert.ok(JSON.parse(couchProxied).current, couchDirect);
  for (const [path, status] of [['/api/team/status', 503], ['/api/does-not-exist?probe=1', 404], ['/api', 404]]) {
    const [direct, proxied] = await same(path, status);
    assert.equal(proxied, direct, path);
    assert.doesNotMatch(proxied, /<app-root/);
  }

  // No wildcard or non-loopback listener on the stack's ports (IPv4 or IPv6).
  const listeners = (await exec('ss', ['-Hltn'])).stdout.split('\n')
    .map(line => line.trim().split(/\s+/)[3]).filter(Boolean)
    .filter(address => /:(8080|8090|5434)$/.test(address));
  assert.deepEqual(listeners.sort(), ['127.0.0.1:5434', '127.0.0.1:8080', '127.0.0.1:8090']);
  console.log('Compose networking smoke passed: collisions, free ports, migrations, repeated up, restart and production web.');
} catch (error) {
  const logs = await compose('logs', '--no-color').catch(() => ({ stdout: '', stderr: '' }));
  console.error(logs.stdout, logs.stderr);
  throw error;
} finally {
  await compose('down', '--volumes');
  if (syncthing.listening) await close(syncthing);
  if (couchdb.listening) await close(couchdb);
  await rm(directory, { recursive: true, force: true });
}
