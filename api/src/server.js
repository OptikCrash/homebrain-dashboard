const { createApp } = require('./app');
const { disconnectPrisma } = require('./db/prisma');

const { createTeamStatus } = require('./status/team');

const { createSyncthingStatus, startSyncthingPolling, pollingInterval: syncthingPollingInterval } = require('./status/syncthing');

const syncthingIntervalMs = syncthingPollingInterval();
const syncthingStatus = createSyncthingStatus();
const teamStatus = createTeamStatus();

const stopSyncthingPolling = startSyncthingPolling({ poll: syncthingStatus.poll, intervalMs: syncthingIntervalMs });

const port = Number(process.env.PORT) || 3000;

const server = createApp({ teamStatus, syncthingStatus }).listen(port, () => {
  console.log(`homebrain-dashboard API listening on port ${port}`);
});

// Let `docker compose down` stop the container promptly.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await Promise.all([
      stopSyncthingPolling(),
      new Promise((resolve) => server.close(resolve)),
    ]);
    await disconnectPrisma();
    process.exit(0);
  });
}
