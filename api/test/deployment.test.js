const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const composeAvailable = spawnSync('docker', ['compose', 'version']).status === 0;

test('Compose reaches host services while preserving team status and database networking', {
  skip: !composeAvailable && 'Docker Compose is required to validate deployment configuration',
}, () => {
  const config = JSON.parse(execFileSync('docker', [
    'compose', '--env-file', '.env.example', 'config', '--format', 'json',
  ], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...(process.env.DOCKER_CONFIG ? { DOCKER_CONFIG: process.env.DOCKER_CONFIG } : {}),
      TEAM_STATUS_DIR: '/tmp/homebrain-deployment-test-status',
    },
    encoding: 'utf8',
  }));
  const { api, postgres } = config.services;
  assert.ok(api.extra_hosts.includes('host.docker.internal=host-gateway'));
  const exampleUrl = readFileSync(path.join(root, '.env.example'), 'utf8')
    .match(/^SYNCTHING_URL=(.+)$/m)[1];
  assert.equal(exampleUrl, 'http://host.docker.internal:8384');
  assert.equal(api.environment.SYNCTHING_URL, exampleUrl);
  assert.equal(api.environment.TEAM_STATUS_DIR, '/logs/status');
  assert.equal(api.environment.BUILDER_LOGS_DIR, undefined);
  assert.equal(api.environment.BUILDER_POLL_INTERVAL_MS, undefined);
  assert.ok(api.volumes.some((volume) => volume.source === '/tmp/homebrain-deployment-test-status'
    && volume.target === '/logs/status' && volume.read_only === true));
  assert.equal(new URL(api.environment.DATABASE_URL).hostname, 'postgres');
  assert.equal(api.depends_on.postgres.condition, 'service_healthy');
  assert.deepEqual(api.networks, postgres.networks);
  assert.equal(postgres.network_mode, undefined);
  assert.ok(postgres.command == null);
  assert.ok(!postgres.ports?.length);
});

test('Home Brain override reaches loopback services with a directly configured API port', {
  skip: !composeAvailable && 'Docker Compose is required to validate deployment configuration',
}, () => {
  for (const port of [undefined, '18090']) {
    const config = JSON.parse(execFileSync('docker', [
      'compose', '--env-file', '.env.example',
      '-f', 'docker-compose.yml', '-f', 'docker-compose.homebrain.yml',
      'config', '--format', 'json',
    ], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ...(process.env.DOCKER_CONFIG ? { DOCKER_CONFIG: process.env.DOCKER_CONFIG } : {}),
        TEAM_STATUS_DIR: '/srv/homebrain/hermes-dev/work/logs/status',
        // Ensure the override replaces even an explicitly configured bridge URL.
        SYNCTHING_URL: 'http://host.docker.internal:8384',
        ...(port ? { DASHBOARD_PORT: port } : {}),
      },
      encoding: 'utf8',
    }));
    const { api, postgres } = config.services;
    assert.equal(api.network_mode, 'host');
    assert.ok(!api.ports?.length);
    assert.ok(!api.extra_hosts?.length);
    assert.ok(!api.networks);
    assert.equal(api.environment.PORT, port || '8090');
    assert.deepEqual(api.healthcheck.test, [
      'CMD-SHELL', 'wget -qO- http://127.0.0.1:$${PORT}/health',
    ]);
    assert.equal(api.environment.SYNCTHING_URL, 'http://127.0.0.1:8384');
    const db = new URL(api.environment.DATABASE_URL);
    assert.equal(db.hostname, '127.0.0.1');
    assert.equal(db.port, '5434');
    assert.equal(db.username, postgres.environment.POSTGRES_USER);
    assert.equal(db.password, postgres.environment.POSTGRES_PASSWORD);
    assert.equal(db.pathname, `/${postgres.environment.POSTGRES_DB}`);
    assert.equal(postgres.network_mode, 'host');
    assert.ok(!postgres.networks);
    assert.ok(!postgres.ports?.length);
    assert.deepEqual(postgres.command, [
      'postgres', '-p', '5434', '-c', 'listen_addresses=127.0.0.1',
    ]);
    assert.deepEqual(postgres.healthcheck.test, [
      'CMD-SHELL', 'pg_isready -h 127.0.0.1 -p 5434 -U $${POSTGRES_USER} -d $${POSTGRES_DB}',
    ]);
    assert.equal(api.depends_on.postgres.condition, 'service_healthy');
    assert.ok(api.volumes.some((volume) => volume.source === '/srv/homebrain/hermes-dev/work/logs/status'
      && volume.target === '/logs/status' && volume.read_only === true));
  }
});
