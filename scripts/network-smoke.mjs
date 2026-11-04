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
const legacy = `${project}-legacy`;
const docker = (...args) => exec('docker', args, { env, timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
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
  // A restart of the fresh hardened cluster above is NOT a legacy upgrade.
  // Independently initialize with the stock image, no hardened args/entrypoint,
  // no host networking/publication. Only this random project's volume is reused.
  const apiImage = (await compose('images', '-q', 'api')).stdout.trim();
  await compose('down', '--volumes');
  await docker('volume', 'create', '--label', `com.docker.compose.project=${project}`,
    '--label', 'com.docker.compose.volume=pgdata', `${project}_pgdata`);
  await docker('run', '-d', '--name', legacy, '--network', 'none',
    '-e', 'POSTGRES_USER=smoke', '-e', 'POSTGRES_PASSWORD=smoke', '-e', 'POSTGRES_DB=smoke',
    '-v', `${project}_pgdata:/var/lib/postgresql/data`, 'postgres:16-alpine');
  const legacySql = query => docker('exec', legacy, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'smoke', '-d', 'smoke', '-Atc', query);
  for (let attempt = 0; ; attempt++) {
    // A successful TCP query proves final startup (stock init's temporary server disables TCP).
    try {
      await docker('exec', legacy, 'psql', '-X', '-w', '-h', '127.0.0.1', '-U', 'smoke', '-d', 'smoke', '-c', 'SELECT 1');
      break;
    } catch (error) {
      if (attempt === 60) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  assert.equal((await docker('exec', legacy, 'cat', '/var/lib/postgresql/data/PG_VERSION')).stdout.trim(), '16');
  assert.match((await legacySql('SELECT type, address, auth_method FROM pg_hba_file_rules')).stdout, /host\|127\.0\.0\.1\|trust/);
  const legacyWrong = await docker('exec', '-e', 'PGPASSWORD=wrong-fixture', legacy,
    'psql', '-X', '-w', '-h', '127.0.0.1', '-U', 'smoke', '-d', 'smoke', '-Atc', 'SELECT 1');
  assert.equal(legacyWrong.stdout.trim(), '1', 'legacy fixture must actually accept a wrong TCP password');
  await docker('run', '--rm', '--network', `container:${legacy}`,
    '-e', 'DATABASE_URL=postgresql://smoke:smoke@127.0.0.1:5432/smoke', apiImage,
    'npx', 'prisma', 'migrate', 'deploy');
  await legacySql("CREATE ROLE upgrade_role LOGIN PASSWORD 'throwaway-upgrade'; SET password_encryption='md5'; CREATE ROLE legacy_md5 LOGIN PASSWORD 'throwaway-md5'; INSERT INTO status_snapshots (service,status,detail) VALUES ('legacy-upgrade','healthy','{\"sentinel\":95}')");
  const identityQuery = 'SELECT system_identifier FROM pg_control_system()';
  const rolesQuery = 'SELECT rolname, rolpassword FROM pg_authid ORDER BY rolname';
  const historyQuery = "SELECT row_to_json(s) FROM status_snapshots s WHERE service='legacy-upgrade'";
  const migrationQuery = 'SELECT row_to_json(m) FROM _prisma_migrations m ORDER BY id';
  const before = [];
  for (const query of [identityQuery, rolesQuery, historyQuery, migrationQuery]) before.push((await legacySql(query)).stdout);
  const originalHba = (await docker('exec', legacy, 'cat', '/var/lib/postgresql/data/pg_hba.conf')).stdout;
  await docker('stop', legacy);
  await docker('rm', legacy); // Named volume is retained; normal Compose takes it over.
  const checkUpgrade = async () => {
    assert.equal((await sql('SHOW listen_addresses')).stdout.trim(), '127.0.0.1');
    assert.equal((await sql('SHOW port')).stdout.trim(), '5434');
    assert.equal((await sql('SHOW hba_file')).stdout.trim(), '/etc/postgresql/dashboard-pg_hba.conf');
    assert.equal((await sql("SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL OR (type LIKE 'host%' AND auth_method <> 'scram-sha-256')")).stdout.trim(), '0');
    await checkPassword();
    // Do not print verifiers, even for disposable roles.
    for (const [index, query] of [identityQuery, rolesQuery, historyQuery, migrationQuery].entries()) {
      assert.ok((await sql(query)).stdout === before[index], `legacy preservation check ${index} failed`);
    }
    assert.ok((await compose('exec', '-T', 'postgres', 'cat', '/var/lib/postgresql/data/pg_hba.conf')).stdout === originalHba);
    const role = await compose('exec', '-T', '-e', 'PGPASSWORD=throwaway-upgrade', 'postgres',
      'psql', '-X', '-w', '-h', '127.0.0.1', '-p', '5434', '-U', 'upgrade_role', '-d', 'smoke', '-Atc', 'SELECT 1');
    assert.equal(role.stdout.trim(), '1');
    await assert.rejects(compose('exec', '-T', '-e', 'PGPASSWORD=throwaway-md5', 'postgres',
      'psql', '-X', '-w', '-h', '127.0.0.1', '-p', '5434', '-U', 'legacy_md5', '-d', 'smoke', '-Atc', 'SELECT 1'), error => {
      assert.match(error.stderr, /password authentication failed for user "legacy_md5"/);
      return true;
    });
    assert.equal((await fetch('http://127.0.0.1:8090/health')).status, 200);
  };
  await compose('up', '-d', '--wait', '--wait-timeout', '120');
  await checkUpgrade();
  await compose('restart');
  await compose('up', '-d', '--wait', '--wait-timeout', '120');
  await compose('up', '-d');
  await checkUpgrade();
  console.log('Backend smoke passed: fresh init, collisions and stock legacy-volume upgrade/restart preservation.');
} catch (error) {
  const logs = await compose('logs', '--no-color').catch(() => ({ stdout: '', stderr: '' }));
  console.error(logs.stdout, logs.stderr);
  throw error;
} finally {
  await docker('rm', '-f', legacy).catch(() => {});
  await compose('down', '--volumes');
  await docker('volume', 'rm', `${project}_pgdata`).catch(() => {});
  if (syncthing.listening) await close(syncthing);
  if (couchdb.listening) await close(couchdb);
  await rm(directory, { recursive: true, force: true });
}
