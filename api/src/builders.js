const { open, stat } = require('node:fs/promises');
const path = require('node:path');

const BUILDERS = ['claude', 'codex'];

function isMissing(error) {
  return error.code === 'ENOENT';
}

// Read backwards so a long-running builder's entire log isn't loaded on each poll.
async function lastLogLine(filename) {
  let file;
  try {
    file = await open(filename, 'r');
    let position = (await file.stat()).size;
    let tail = Buffer.alloc(0);
    while (position > 0) {
      const size = Math.min(position, 4096);
      position -= size;
      const chunk = Buffer.alloc(size);
      const { bytesRead } = await file.read(chunk, 0, size, position);
      tail = Buffer.concat([chunk.subarray(0, bytesRead), tail]);
      // Ignore a final newline, including CRLF, but preserve other whitespace.
      const end = tail.length - (tail.at(-1) === 10 ? 1 : 0);
      const newline = tail.lastIndexOf(10, end - 1);
      if (newline >= 0 || position === 0) {
        let line = tail.subarray(newline + 1, end).toString('utf8');
        if (line.endsWith('\r')) line = line.slice(0, -1);
        return line || null;
      }
    }
    return null;
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
  return Promise.all(BUILDERS.map(async (name) => {
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
