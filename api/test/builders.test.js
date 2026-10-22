const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readBuilderStatus, parseJobName, lastLogLine } = require('../src/checks/builders');

let logsDir;

async function write(name, content = '') {
  await fs.writeFile(path.join(logsDir, name), content);
}

async function age(name, ms) {
  const t = new Date(Date.now() - ms);
  await fs.utimes(path.join(logsDir, name), t, t);
}

beforeEach(async () => {
  logsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'builder-logs-'));
});

afterEach(async () => {
  await fs.rm(logsDir, { recursive: true, force: true });
});

describe('parseJobName', () => {
  test('issue jobs carry the issue number and builder', () => {
    assert.deepEqual(parseJobName('issue-4-codex'), { kind: 'issue', number: 4, builder: 'codex' });
    assert.deepEqual(parseJobName('issue-12-claude'), { kind: 'issue', number: 12, builder: 'claude' });
  });

  test('review jobs carry the PR number', () => {
    assert.deepEqual(parseJobName('review-10'), { kind: 'pr', number: 10 });
  });

  test('other names are null', () => {
    assert.equal(parseJobName('wake'), null);
    assert.equal(parseJobName('issue-x-codex'), null);
  });
});

describe('readBuilderStatus', () => {
  test('running job: .pid without .done reports running + last log line', async () => {
    await write('issue-4-codex.pid', '1234\n');
    await write('issue-4-codex.log', 'starting\nrunning tests\n');

    const status = await readBuilderStatus({ logsDir });

    assert.equal(status.available, true);
    assert.equal(status.jobs.length, 1);
    const [job] = status.jobs;
    assert.equal(job.name, 'issue-4-codex');
    assert.deepEqual(job.target, { kind: 'issue', number: 4, builder: 'codex' });
    assert.equal(job.state, 'running');
    assert.equal(job.lastLogLine, 'running tests');
    assert.equal(job.stale, false);
    assert.deepEqual(status.builders, { codex: { state: 'running', jobs: ['issue-4-codex'] } });
  });

  test('.done next to .pid reports idle', async () => {
    await write('issue-4-codex.pid', '1234\n');
    await write('issue-4-codex.log', 'all done\n');
    await write('issue-4-codex.done');
    await write('review-10.pid', '99\n');
    await write('review-10.done');

    const { jobs, builders } = await readBuilderStatus({ logsDir });

    assert.deepEqual(
      jobs.map((j) => [j.name, j.state, j.lastLogLine]),
      [
        ['issue-4-codex', 'idle', undefined],
        ['review-10', 'idle', undefined],
      ],
    );
    assert.deepEqual(jobs[1].target, { kind: 'pr', number: 10 });
    assert.deepEqual(builders, { codex: { state: 'idle', jobs: [] } });
  });

  test('no .pid files reports nothing running (unrelated logs ignored)', async () => {
    await write('issue-4-codex.log', 'old log\n');
    await write('wake.log', 'woke up\n');

    const status = await readBuilderStatus({ logsDir });

    assert.deepEqual(status, { available: true, builders: {}, jobs: [] });
  });

  test('builder is running if any of its jobs is', async () => {
    await write('issue-3-claude.pid');
    await write('issue-3-claude.done');
    await write('issue-5-claude.pid');
    await write('review-10.pid');

    const { builders, jobs } = await readBuilderStatus({ logsDir });

    assert.deepEqual(builders, { claude: { state: 'running', jobs: ['issue-5-claude'] } });
    const review = jobs.find((j) => j.name === 'review-10');
    assert.equal(review.state, 'running');
    assert.equal(review.lastLogLine, null);
  });

  test('running job with no recent activity is flagged stale', async () => {
    await write('issue-4-codex.pid');
    await write('issue-4-codex.log', 'stuck\n');
    await age('issue-4-codex.pid', 3 * 60 * 60 * 1000);
    await age('issue-4-codex.log', 3 * 60 * 60 * 1000);

    const [job] = (await readBuilderStatus({ logsDir })).jobs;

    assert.equal(job.state, 'running');
    assert.equal(job.stale, true);
  });

  test('missing logs dir reports unavailable', async () => {
    const status = await readBuilderStatus({ logsDir: path.join(logsDir, 'nope') });

    assert.deepEqual(status, { available: false, error: 'ENOENT', jobs: [] });
  });
});

describe('lastLogLine', () => {
  test('skips trailing blank lines', async () => {
    await write('a.log', 'first\nlast real line\n\n   \n');
    assert.equal(await lastLogLine(path.join(logsDir, 'a.log')), 'last real line');
  });

  test('only reads the tail of a big log', async () => {
    await write('big.log', `${'x'.repeat(100_000)}\nnear the end\n${'y'.repeat(50)}`);
    assert.equal(await lastLogLine(path.join(logsDir, 'big.log'), { maxBytes: 100 }), 'y'.repeat(50));
  });

  test('truncates very long lines', async () => {
    await write('long.log', 'z'.repeat(1000));
    const line = await lastLogLine(path.join(logsDir, 'long.log'));
    assert.equal(line, `${'z'.repeat(300)}…`);
  });

  test('empty or missing log is null', async () => {
    await write('empty.log');
    assert.equal(await lastLogLine(path.join(logsDir, 'empty.log')), null);
    assert.equal(await lastLogLine(path.join(logsDir, 'missing.log')), null);
  });
});
