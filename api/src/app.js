const express = require('express');
const { createBuilderStatus } = require('./status/builders');

// Builds the Express app without binding a port, so tests can mount it on an
// ephemeral port.
function createApp({ builderStatus = createBuilderStatus() } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
    });
  });

  app.get('/api/status/builders', async (req, res) => {
    try {
      res.json(await builderStatus.getStatus());
    } catch {
      res.status(503).json({ error: 'Builder status unavailable' });
    }
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}

module.exports = { createApp };
