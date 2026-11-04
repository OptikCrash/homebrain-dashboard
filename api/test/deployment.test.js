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
    const { api, postgres, web } = config.services;
    for (const service of [api, postgres, web]) {
      assert.equal(service.network_mode, 'host');
      assert.ok(!service.ports?.length);
      assert.ok(!service.networks);
      assert.ok(!service.extra_hosts?.length);
      assert.ok(service.post_start.length);
      assert.equal(service.restart, 'unless-stopped');
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
    assert.equal(postgres.environment.POSTGRES_INITDB_ARGS, '--auth-host=scram-sha-256');
    assert.match(postgres.healthcheck.test[1], /-h 127\.0\.0\.1 -p 5434/);
    assert.ok(api.volumes.filter(v => v.type === 'bind').every(v => v.read_only));
    assert.equal(api.healthcheck.test.at(-1), 'http://127.0.0.1:8090/health');
    assert.equal(web.depends_on.api.condition, 'service_started');
    assert.match(web.healthcheck.test.at(-1), /http:\/\/127\.0\.0\.1:8080\/healthz/);
    assert.ok(!web.volumes?.length, 'web needs no mounts');
    assert.ok(!web.environment, 'web gets no environment or credentials');
  }
});

// These guards also run on builders without Docker.
test('shipped sources keep loopback listeners, startup guards and volume identity', () => {
  const compose = readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
  assert.doesNotMatch(compose, /ports:|extra_hosts:|@postgres:|0\.0\.0\.0|5433|5432|trust/);
  assert.match(compose, /pgdata:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /service_healthy/);
  assert.equal((compose.match(/restart: unless-stopped/g) || []).length, 3);
  assert.match(compose, /POSTGRES_INITDB_ARGS: --auth-host=scram-sha-256/);
  assert.equal((compose.match(/network_mode: host/g) || []).length, 3);
  const server = readFileSync(path.join(root, 'api/src/server.js'), 'utf8');
  assert.match(server, /\.listen\(port, '127\.0\.0\.1'/);
  assert.match(server, /server.once\('error'/);
  assert.match(readFileSync(path.join(root, 'api/Dockerfile'), 'utf8'), /EXPOSE 8090/);
});

test('web image: production build with npm ci, nginx-only runtime, loopback listener and /api proxy', () => {
  const web = path.join(root, 'web');
  const read = file => readFileSync(path.join(web, file), 'utf8');
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);

  const dockerfile = read('Dockerfile');
  const stages = dockerfile.split(/^FROM /m).slice(1);
  assert.equal(stages.length, 2);
  assert.match(stages[0], /^COPY package\*\.json \.\/$/m);
  assert.match(stages[0], /^RUN npm ci$/m);
  assert.match(stages[0], /npm run build -- --configuration production/);
  assert.doesNotMatch(dockerfile, /npm install|ng serve|npm start/);
  // Runtime stage: nginx plus the built browser files only; no Node toolchain.
  assert.match(stages[1], /^nginx:[\w.-]+alpine\b/);
  assert.doesNotMatch(stages[1], /node|npm/i);
  // @angular/build:application's default output for project `web`.
  assert.match(stages[1], /^COPY --from=build \/app\/dist\/web\/browser \/usr\/share\/nginx\/html$/m);
  assert.equal(JSON.parse(read('angular.json')).projects.web.architect.build.options.outputPath, undefined);
  assert.match(stages[1], /^USER nginx$/m);
  // Stock entrypoint scripts would add a wildcard default server.
  assert.match(stages[1], /rm -rf \/docker-entrypoint\.d \/etc\/nginx\/conf\.d/);

  const ignored = read('.dockerignore').split('\n');
  for (const entry of ['node_modules', 'dist', '.angular', '.env', '.env.*']) assert.ok(ignored.includes(entry), entry);

  const nginx = read('nginx.conf').replace(/#.*$/gm, '');
  assert.deepEqual(nginx.match(/^\s*listen\s+[^;]+;/gm).map(l => l.trim()), ['listen 127.0.0.1:8080;']);
  assert.doesNotMatch(nginx, /include\s+\/etc\/nginx\/conf\.d|0\.0\.0\.0|\[::\]/);
  // proxy_pass without a URI forwards the original path and query unchanged.
  assert.deepEqual(nginx.match(/proxy_pass\s+[^;]+;/g), ['proxy_pass http://127.0.0.1:8090;', 'proxy_pass http://127.0.0.1:8090;']);
  assert.match(nginx, /location = \/api \{/);
  assert.match(nginx, /location \^~ \/api\/ \{/);
  assert.doesNotMatch(nginx, /proxy_intercept_errors|error_page/);
  assert.match(nginx, /try_files \$uri =404;/);
  assert.match(nginx, /try_files \$uri \/index\.html;/);
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
