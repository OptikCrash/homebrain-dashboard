// Checks the root package.json shortcuts and that `npm run all` (scripts/dev-all.sh) starts both
// processes (passing its arguments to docker compose) and stops both on Ctrl-C. `docker` and `npm` are replaced by stubs on PATH.
// Run with: npm test (from the repo root)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const script = new URL('./dev-all.sh', import.meta.url).pathname;
const homebrainFiles = '-f docker-compose.yml -f docker-compose.homebrain.yml';

test('root scripts point at compose, the web dev server and dev-all.sh', () => {
  assert.equal(pkg.scripts.backend, 'docker compose up --build');
  assert.equal(pkg.scripts.frontend, 'npm --prefix web start');
  assert.equal(pkg.scripts.all, 'sh scripts/dev-all.sh');
  assert.equal(pkg.scripts['backend:homebrain'], `docker compose ${homebrainFiles} up --build`);
  assert.equal(pkg.scripts['all:homebrain'], `sh scripts/dev-all.sh ${homebrainFiles}`);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});

test('dev-all.sh starts backend and frontend and stops both on SIGINT', { timeout: 10_000 }, (t) =>
  runDevAll(t, [], 'docker compose up --build'));

test('dev-all.sh passes its arguments to docker compose (all:homebrain)', { timeout: 10_000 }, (t) =>
  runDevAll(t, homebrainFiles.split(' '), `docker compose ${homebrainFiles} up --build`));

async function runDevAll(t, args, expectedDocker) {
  const dir = mkdtempSync(join(tmpdir(), 'dev-all-'));
  const log = join(dir, 'log');
  writeFileSync(log, '');
  // The npm stub starts an `ng` stub and, like real npm, does not forward SIGTERM to it:
  // dev-all.sh has to stop ng itself or it would keep port 4200.
  const stubs = {
    docker: '',
    npm: 'ng-stub &',
    'ng-stub': '',
  };
  for (const [name, extra] of Object.entries(stubs)) {
    const stub = join(dir, name);
    writeFileSync(stub, `#!/bin/sh
echo "started ${name} $*" >> "$STUB_LOG"
${extra}
trap 'echo "stopped ${name}" >> "$STUB_LOG"; exit 0' TERM
while :; do sleep 0.05; done
`);
    chmodSync(stub, 0o755);
  }

  // Own process group, so cleanup can kill any stub a regression leaves running.
  const child = spawn('sh', [script, ...args], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, STUB_LOG: log },
    stdio: 'ignore',
    detached: true,
  });
  t.after(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  const lines = (prefix) => readFileSync(log, 'utf8').split('\n').filter((l) => l.startsWith(prefix)).sort();

  for (let i = 0; lines('started').length < 3 && i < 100; i++) await delay(50);
  assert.deepEqual(lines('started'), [
    `started ${expectedDocker}`,
    'started ng-stub ',
    'started npm --prefix web start',
  ]);

  child.kill('SIGINT');
  assert.equal(await exited, 130);
  for (let i = 0; lines('stopped').length < 3 && i < 40; i++) await delay(50);
  assert.deepEqual(lines('stopped'), ['stopped docker', 'stopped ng-stub', 'stopped npm']);
}
