const fs = require('node:fs/promises');
const path = require('node:path');

// One status file per bot in HOST_STATUS_DIR, all sharing the schema in PLAN.md.
const BOTS = ['chopper', 'ap5'];
const STALE_AFTER_MS = 3 * 60 * 1000;
const containerStates = new Set(['running', 'restarting', 'exited', 'missing']);
const apiStates = new Set(['up', 'down']);
const timestampFields = ['checked_at', 'container_started_at', 'last_message_at', 'last_reply_at'];
const statusDirectory = () => process.env.HOST_STATUS_DIR || '/srv/homebrain/status';

const text = (value) => (typeof value === 'string' && value.trim() ? value : null);
const timestamp = (value) => (text(value) && Number.isFinite(Date.parse(value)) ? value : null);

// Copies only the documented schema fields; anything else in the file is dropped.
function parseBotHealth(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const health = {
    name: text(raw.name),
    container: containerStates.has(raw.container) ? raw.container : null,
    api: apiStates.has(raw.api) ? raw.api : null,
    readiness: raw.api === 'up' ? text(raw.readiness) : null,
  };
  for (const field of timestampFields) health[field] = timestamp(raw[field]);
  return health;
}

// A missing or unparseable checked_at can't be trusted as current either.
function isStale(checkedAt, now = Date.now()) {
  const checked = Date.parse(checkedAt);
  return !Number.isFinite(checked) || now - checked > STALE_AFTER_MS;
}

// Returns null when the file doesn't exist (bot not deployed / cron not run yet)
// or can't be parsed (e.g. mid-write); other read errors propagate.
async function readBotHealth(bot, { statusDir = statusDirectory() } = {}) {
  let contents;
  try {
    contents = await fs.readFile(path.join(statusDir, `${bot}.json`), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    return parseBotHealth(JSON.parse(contents));
  } catch {
    return null;
  }
}

async function readAllBotHealth({ statusDir = statusDirectory(), now = Date.now() } = {}) {
  return Promise.all(BOTS.map(async (bot) => {
    const health = await readBotHealth(bot, { statusDir });
    if (!health) return { bot, present: false };
    return { bot, present: true, ...health, stale: isStale(health.checked_at, now) };
  }));
}

module.exports = { BOTS, STALE_AFTER_MS, parseBotHealth, isStale, readBotHealth, readAllBotHealth };
