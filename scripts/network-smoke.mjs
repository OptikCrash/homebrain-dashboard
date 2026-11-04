// CI-only Docker integration. Every volume belongs to a fresh random test project.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'dashboard-smoke-'));
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
const compose = (...more) => exec('docker', [...args, ...more], { env, timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
const close = server => new Promise(resolve => server.close(resolve));
const listen = (server, port) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});
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
  for (const port of [5434, 8090]) {
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
  console.log('Backend networking smoke passed: collisions, free ports, migrations, repeated up and restart.');
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
