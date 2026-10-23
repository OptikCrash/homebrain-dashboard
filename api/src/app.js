const express = require('express');
const { createBackupStatus } = require('./status/backups');
const { createCouchdbStatus } = require('./status/couchdb');
const { createSyncthingStatus } = require('./status/syncthing');
const { createTeamStatus } = require('./status/team');

// Builds the Express app without binding a port, so tests can mount it on an
// ephemeral port.
function createApp({
  backupStatus = createBackupStatus(),
  teamStatus = createTeamStatus(),
  syncthingStatus = createSyncthingStatus(),
  couchdbStatus = createCouchdbStatus(),
} = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
    });
  });

  app.get('/api/team/status', async (req, res) => {
    try {
      res.json(await teamStatus.getStatus());
    } catch {
      res.status(503).json({ error: 'Team status unavailable' });
    }
  });

  app.get('/api/status/syncthing', async (req, res) => {
    try {
      res.json(await syncthingStatus.getStatus());
    } catch {
      res.status(503).json({ error: 'Syncthing status unavailable' });
    }
  });

  app.get('/api/status/couchdb', async (req, res) => {
    try {
      res.json(await couchdbStatus.getStatus());
    } catch {
      res.status(503).json({ error: 'CouchDB status unavailable' });
    }
  });

  app.get('/api/status/backups', async (req, res) => {
    try {
      res.json(await backupStatus.getStatus());
    } catch {
      res.status(503).json({ error: 'Backup status unavailable' });
    }
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}

module.exports = { createApp };
