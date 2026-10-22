const fs = require('node:fs/promises');
const path = require('node:path');

// Dev builder status, read from the builder host's logs dir (bind-mounted
// read-only into the API container, see docker-compose.yml).
//
// Layout of that dir: each builder job writes `<job>.pid` when it starts,
// `<job>.log` as it runs and `<job>.done` when it finishes. Job names say what
// the job is for: `issue-4-codex` is the codex builder on issue #4, `review-10`
// is a review of PR #10. Anything that isn't a `*.pid` (e.g. `wake.log`) is
// ignored.
//
// Deliberate v1 limitation: no GitHub PR/issue counts here. Getting them needs
// a GitHub token inside the dashboard container, which we're avoiding (see
// PLAN.md open questions). The issue/PR a job is for comes from its file name
// only.

const DEFAULT_LOGS_DIR = '/logs';
// A running job whose .pid and .log haven't changed for this long is flagged
// stale: the process may have died without writing .done. We can't check the
// pid itself, since the container has its own pid namespace.
const DEFAULT_STALE_AFTER_MS = 2 * 60 * 60 * 1000;
// Only the end of a log is read, so huge logs (or ones with no newlines) cost
// at most this much.
const TAIL_BYTES = 64 * 1024;
// The endpoint has no auth yet, so don't expose more of a log line than needed.
const MAX_LINE_LENGTH = 300;

// `issue-4-codex` -> { kind: 'issue', number: 4, builder: 'codex' },
// `review-10` -> { kind: 'pr', number: 10 }, anything else -> null.
function parseJobName(name) {
  let match = /^issue-(\d+)-([a-z0-9]+)$/i.exec(name);
  if (match) {
    return { kind: 'issue', number: Number(match[1]), builder: match[2] };
  }
  match = /^review-(\d+)$/i.exec(name);
  if (match) {
    return { kind: 'pr', number: Number(match[1]) };
  }
  return null;
}

// stat() that follows symlinks and returns null for missing/unreadable files.
async function statFile(file) {
  try {
    const stats = await fs.stat(file);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

// Last non-blank line of a file, read from at most its last `maxBytes`.
// Returns null if the file is missing or has no non-blank lines in that range.
async function lastLogLine(file, { maxBytes = TAIL_BYTES } = {}) {
  let handle;
  try {
    handle = await fs.open(file, 'r');
  } catch {
    return null;
  }
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    // The file may shrink between stat() and read(); only decode what was
    // actually read so the unread tail of the buffer doesn't leak NUL bytes.
    const { bytesRead } = await handle.read(buffer, 0, length, size - length);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n|\r/);
    // If we started mid-file, the first line is probably partial; still use
    // it if it's all we have (one huge line with no newlines).
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line !== '') {
        return line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line;
      }
    }
    return null;
  } finally {
    await handle.close();
  }
}

// One entry per job with a .pid file, sorted by name.
async function readBuilderStatus({
  logsDir = process.env.BUILDER_LOGS_DIR || DEFAULT_LOGS_DIR,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  now = Date.now(),
} = {}) {
  let names;
  try {
    names = await fs.readdir(logsDir);
  } catch (err) {
    return { available: false, error: err.code || err.message, jobs: [] };
  }

  const jobNames = names
    .filter((name) => name.endsWith('.pid'))
    .map((name) => name.slice(0, -'.pid'.length))
    .filter((name) => name !== '')
    .sort();

  const jobs = [];
  for (const name of jobNames) {
    const pidStats = await statFile(path.join(logsDir, `${name}.pid`));
    if (!pidStats) continue;

    const job = { name, target: parseJobName(name) };
    // A .done file means the job finished, whatever the .pid says.
    if (await statFile(path.join(logsDir, `${name}.done`))) {
      jobs.push({ ...job, state: 'idle' });
      continue;
    }

    const logFile = path.join(logsDir, `${name}.log`);
    const logStats = await statFile(logFile);
    const lastActivity = Math.max(pidStats.mtimeMs, logStats ? logStats.mtimeMs : 0);
    jobs.push({
      ...job,
      state: 'running',
      lastLogLine: logStats ? await lastLogLine(logFile) : null,
      lastActivityAt: new Date(lastActivity).toISOString(),
      stale: now - lastActivity > staleAfterMs,
    });
  }

  return { available: true, builders: summarizeBuilders(jobs), jobs };
}

// Per-builder view for the card: every builder named in an `issue-<n>-<builder>`
// job is listed, running if any of its jobs is. Builders are discovered from
// the job names, not a fixed list.
function summarizeBuilders(jobs) {
  const builders = {};
  for (const job of jobs) {
    const builder = job.target && job.target.builder;
    if (!builder) continue;
    if (job.state === 'running') {
      const current = builders[builder];
      builders[builder] = { state: 'running', jobs: [...(current?.jobs ?? []), job.name] };
    } else if (!builders[builder]) {
      builders[builder] = { state: 'idle', jobs: [] };
    }
  }
  return builders;
}

module.exports = { readBuilderStatus, parseJobName, lastLogLine, DEFAULT_STALE_AFTER_MS };
