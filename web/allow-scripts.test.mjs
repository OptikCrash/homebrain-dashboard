// Guards the npm install-script allowlist in package.json (see README "Install scripts").
// Run with: node --test allow-scripts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

test('allowScripts approves exactly the four packages npm flags', () => {
  assert.deepEqual(pkg.allowScripts, {
    '@parcel/watcher': true,
    esbuild: true,
    lmdb: true,
    'msgpackr-extract': true,
  });
});
