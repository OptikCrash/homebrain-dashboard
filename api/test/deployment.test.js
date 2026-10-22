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
  assert.ok(!postgres.ports?.length);
});
