const { spawn } = require('node:child_process');
const { unlinkSync } = require('node:fs');
const { port, reserve } = require('./listen');
(async () => {
  try { unlinkSync('/tmp/dashboard-ready'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const socket = await reserve(port());
  // Hold the API port throughout migrations; never migrate after a failed probe.
  const child = spawn('node_modules/.bin/prisma', ['migrate', 'deploy'], { stdio: 'inherit' });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => child.kill(signal));
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  await new Promise(resolve => socket.close(resolve));
  if (code !== 0) process.exit(1);
  require('./server');
})().catch(error => { console.error(error.message); process.exit(1); });
