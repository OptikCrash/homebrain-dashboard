const { createApp } = require('./app');
const { disconnectPrisma } = require('./db/prisma');

const { createBuilderStatus, startBuilderPolling, pollingInterval } = require('./status/builders');

const intervalMs = pollingInterval();
const builderStatus = createBuilderStatus();
const stopPolling = startBuilderPolling({ poll: builderStatus.poll, intervalMs });

const port = Number(process.env.PORT) || 3000;

const server = createApp({ builderStatus }).listen(port, () => {
  console.log(`homebrain-dashboard API listening on port ${port}`);
});

// Let `docker compose down` stop the container promptly.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await Promise.all([
      stopPolling(),
      new Promise((resolve) => server.close(resolve)),
    ]);
    await disconnectPrisma();
    process.exit(0);
  });
}
