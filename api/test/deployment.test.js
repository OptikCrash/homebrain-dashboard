const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const composeAvailable = spawnSync('docker', ['compose', 'version']).status === 0;

test('default and compatibility Compose configurations use loopback host networking', {
  skip: !composeAvailable && 'Docker Compose is required to validate deployment configuration',
}, () => {
  for (const files of [[], ['-f', 'docker-compose.yml', '-f', 'docker-compose.homebrain.yml']]) {
    const config = JSON.parse(execFileSync('docker', [
      'compose', '--env-file', '.env.example', ...files, 'config', '--format', 'json',
    ], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } }));
    const { api, postgres } = config.services;
    for (const service of [api, postgres]) {
      assert.equal(service.network_mode, 'host');
      assert.ok(!service.ports?.length);
      assert.ok(!service.networks);
      assert.ok(!service.extra_hosts?.length);
      assert.ok(service.post_start.length);
      assert.equal(service.restart, 'no');
    }
    assert.equal(api.environment.PORT, '8090');
    assert.equal(api.environment.SYNCTHING_URL, 'http://127.0.0.1:8384');
    assert.equal(api.environment.COUCHDB_URL, 'http://127.0.0.1:5984');
    const db = new URL(api.environment.DATABASE_URL);
    assert.equal(db.hostname, '127.0.0.1');
    assert.equal(db.port, '5434');
    assert.equal(api.depends_on.postgres.condition, 'service_healthy');
    assert.deepEqual(postgres.command, ['postgres', '-p', '5434', '-c', 'listen_addresses=127.0.0.1']);
    assert.ok(postgres.volumes.some(v => v.source === config.volumes.pgdata.name && v.target === '/var/lib/postgresql/data') || postgres.volumes.some(v => v.source === 'pgdata' && v.target === '/var/lib/postgresql/data'));
    assert.equal(postgres.environment.POSTGRES_HOST_AUTH_METHOD, undefined);
    assert.match(postgres.healthcheck.test[1], /-h 127\.0\.0\.1 -p 5434/);
    assert.ok(api.volumes.filter(v => v.type === 'bind').every(v => v.read_only));
    assert.equal(api.healthcheck.test.at(-1), 'http://127.0.0.1:8090/health');
  }
});

// These guards also run on builders without Docker.
test('shipped sources keep loopback listeners, startup guards and volume identity', () => {
  const compose = readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
  assert.doesNotMatch(compose, /ports:|extra_hosts:|@postgres:|0\.0\.0\.0|5433|5432|trust/);
  assert.match(compose, /pgdata:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /service_healthy/);
  assert.equal((compose.match(/network_mode: host/g) || []).length, 2);
  const server = readFileSync(path.join(root, 'api/src/server.js'), 'utf8');
  assert.match(server, /\.listen\(port, '127\.0\.0\.1'/);
  assert.match(server, /server.once\('error'/);
  assert.match(readFileSync(path.join(root, 'api/Dockerfile'), 'utf8'), /EXPOSE 8090/);
});

test('Docker image installs exactly what the committed lockfile pins', () => {
  const api = path.join(root, 'api');
  const pkg = JSON.parse(readFileSync(path.join(api, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(path.join(api, 'package-lock.json'), 'utf8'));
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);

  const dockerfile = readFileSync(path.join(api, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /^COPY package\*\.json \.\/$/m);
  assert.match(dockerfile, /^RUN npm ci --omit=dev\b/m);
  assert.doesNotMatch(dockerfile, /npm install/);
});
