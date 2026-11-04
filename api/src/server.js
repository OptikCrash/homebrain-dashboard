const { createBackupStatus, startBackupPolling, pollingInterval: backupPollingInterval } = require('./status/backups');
const { createApp } = require('./app');
const { disconnectPrisma } = require('./db/prisma');

const { createTeamStatus } = require('./status/team');

const { createSyncthingStatus, startSyncthingPolling, pollingInterval: syncthingPollingInterval } = require('./status/syncthing');

const { createCouchdbStatus, startCouchdbPolling, pollingInterval: couchdbPollingInterval } = require('./status/couchdb');

const backupIntervalMs = backupPollingInterval();
const backupStatus = createBackupStatus();

const couchdbIntervalMs = couchdbPollingInterval();
const couchdbStatus = createCouchdbStatus();
const syncthingIntervalMs = syncthingPollingInterval();
const syncthingStatus = createSyncthingStatus();
const teamStatus = createTeamStatus();

const stopSyncthingPolling = startSyncthingPolling({ poll: syncthingStatus.poll, intervalMs: syncthingIntervalMs });

const stopCouchdbPolling = startCouchdbPolling({ poll: couchdbStatus.poll, intervalMs: couchdbIntervalMs });

const stopBackupPolling = startBackupPolling({ poll: backupStatus.poll, intervalMs: backupIntervalMs });

const port = require('./listen').port();

const server = createApp({ backupStatus, teamStatus, syncthingStatus, couchdbStatus }).listen(port, '127.0.0.1', () => {
  require('node:fs').writeFileSync('/tmp/dashboard-ready', '');
  console.log(`homebrain-dashboard API listening on 127.0.0.1:${port}`);
});

server.once('error', () => {
  console.error(`API failed to bind 127.0.0.1:${port}; free the port or stop the other listener.`);
  process.exit(1);
});

// Let `docker compose down` stop the container promptly.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await Promise.all([
      stopBackupPolling(),
      stopSyncthingPolling(),
      stopCouchdbPolling(),
      new Promise((resolve) => server.close(resolve)),
    ]);
    await disconnectPrisma();
    process.exit(0);
  });
}
