// Guards the shape of .github/workflows/ci.yml: one job whose id is the required `ci` check,
// read-only token, no secrets, no pull_request_target. Plain text checks (no YAML dependency).
// Run with: npm test (from the repo root)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const yml = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const code = yml.replace(/^\s*#.*$/gm, '');

test('ci workflow has a single job `ci` with no name override', () => {
  const jobs = code.slice(code.indexOf('\njobs:'));
  assert.deepEqual(jobs.match(/^ {2}\S+:/gm), ['  ci:']);
  assert.doesNotMatch(jobs, /^ {4}name:/m);
});

test('ci workflow triggers, permissions and no secrets', () => {
  assert.match(code, /^on:\n {2}pull_request:\n {4}branches: \[develop, main\]\n {2}push:\n {4}branches: \[develop\]\n\n/m);
  assert.match(code, /^permissions:\n {2}contents: read\n/m);
  assert.doesNotMatch(code, /pull_request_target/);
  assert.doesNotMatch(code, /secrets\./);
});

test('ci workflow runs api tests against a postgres:16 service', () => {
  assert.match(code, /image: postgres:16\n/);
  assert.match(code, /DATABASE_URL: postgresql:\/\/postgres:postgres@localhost:5432\/postgres/);
  assert.match(code, /npm run db:deploy\n\s+npm test/);
});
