const { open, stat, readdir } = require('node:fs/promises');
const path = require('node:path');

const MAX_TAIL_BYTES = 64 * 1024;

function isMissing(error) {
  return error.code === 'ENOENT';
}

// Read backwards so a long-running builder's entire log isn't loaded on each poll.
async function lastLogLine(filename) {
  let file;
  try {
    file = await open(filename, 'r');
    const size = (await file.stat()).size;
    const length = Math.min(size, MAX_TAIL_BYTES);
    if (!length) return null;
    const tail = Buffer.alloc(length);
    const { bytesRead } = await file.read(tail, 0, length, size - length);
    const content = tail.subarray(0, bytesRead);
    // Ignore one final newline, including CRLF, preserving other whitespace.
    const end = content.length - (content.at(-1) === 10 ? 1 : 0);
    const newline = end > 0 ? content.lastIndexOf(10, end - 1) : -1;
    let start = newline + 1;
    // Oversized lines return only their suffix. Skip partial UTF-8 characters
    // at the scan boundary rather than introducing replacement characters.
    if (start === 0 && size > length) {
      while (start < end && (content[start] & 0xc0) === 0x80) start++;
    }
    let line = content.subarray(start, end).toString('utf8');
    if (line.endsWith('\r')) line = line.slice(0, -1);
    return line || null;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  } finally {
    if (file) await file.close();
  }
}

async function readBuilderStatus(logsDir = process.env.LOGS || '/var/log/builders') {
  // Deliberate v1 limitation: no GitHub PR/issue counts, keeping GitHub tokens
  // and credentials out of the dashboard container.
  let entries;
  try {
    entries = await readdir(logsDir, { withFileTypes: true });
  } catch (error) {
    if (!isMissing(error)) throw error;
    entries = [];
  }
  // Keep the dashboard's known builders visible when idle; discover additional
  // builders from PID files or logs retained after their PID is removed.
  const names = new Set(['claude', 'codex']);
  for (const entry of entries) {
    if (entry.isFile() && /\.(pid|log)$/.test(entry.name)) {
      const name = entry.name.replace(/\.(pid|log)$/, '');
      if (name) names.add(name);
    }
  }
  return Promise.all([...names].sort().map(async (name) => {
    let running;
    try {
      running = (await stat(path.join(logsDir, `${name}.pid`))).isFile();
    } catch (error) {
      if (!isMissing(error)) throw error;
      running = false;
    }
    // PID-file presence is the host wrapper's signal. Host process IDs cannot
    // be checked from the container's PID namespace; stale files read as running.
    return {
      name,
      status: running ? 'running' : 'idle',
      lastLogLine: running ? await lastLogLine(path.join(logsDir, `${name}.log`)) : null,
    };
  }));
}

module.exports = { readBuilderStatus };
