// Checks the root package.json shortcuts and that `npm run all` (scripts/dev-all.sh) starts both
// processes and stops both on Ctrl-C. `docker` and `npm` are replaced by stubs on PATH.
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

test('root scripts point at compose, the web dev server and dev-all.sh', () => {
  assert.equal(pkg.scripts.backend, 'docker compose up --build');
  assert.equal(pkg.scripts.frontend, 'npm --prefix web start');
  assert.equal(pkg.scripts.all, 'sh scripts/dev-all.sh');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});

test('dev-all.sh starts backend and frontend and stops both on SIGINT', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dev-all-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'log');
  writeFileSync(log, '');
  for (const name of ['docker', 'npm']) {
    const stub = join(dir, name);
    writeFileSync(stub, `#!/bin/sh
echo "started ${name} $*" >> "$STUB_LOG"
trap 'echo "stopped ${name}" >> "$STUB_LOG"; exit 0' TERM
while :; do sleep 0.05; done
`);
    chmodSync(stub, 0o755);
  }

  const child = spawn('sh', [script], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, STUB_LOG: log },
    stdio: 'ignore',
  });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  const lines = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);

  for (let i = 0; lines().length < 2 && i < 100; i++) await delay(50);
  assert.deepEqual(lines().sort(), ['started docker compose up --build', 'started npm --prefix web start']);

  child.kill('SIGINT');
  assert.equal(await exited, 130);
  assert.deepEqual(lines().filter((l) => l.startsWith('stopped')).sort(), ['stopped docker', 'stopped npm']);
});
