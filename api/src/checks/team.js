const fs = require('node:fs/promises');
const path = require('node:path');

// Keep filename ordering metadata out of the parsed JSON/API response.
const INSTANCE_NUMBER = Symbol('instanceNumber');
const phases = new Set(['starting', 'building', 'pushing', 'reviewing', 'done', 'failed', 'no-changes', 'stopped']);
const statusDirectory = () => process.env.TEAM_STATUS_DIR || '/logs/status';

async function readTeamRoster({ statusDir = statusDirectory() } = {}) {
  try {
    const roster = JSON.parse(await fs.readFile(path.join(statusDir, 'roles.json'), 'utf8'));
    if (!Array.isArray(roster)) throw new TypeError('Team roster must be an array');
    if (roster.some((member) => !member || typeof member !== 'object'
      || Array.isArray(member) || typeof member.name !== 'string' || !member.name.trim())) {
      throw new TypeError('Team roster entries must be objects with a non-empty name');
    }
    return roster;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readTeamInstances({ statusDir = statusDirectory() } = {}) {
  let files;
  try {
    files = await fs.readdir(statusDir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const instances = [];
  // Sequential reads bound file-descriptor use even with a large job history.
  for (const file of files.sort()) {
    const match = /^(.+)-(\d+)\.json$/.exec(file);
    if (!match) continue;
    try {
      const instance = JSON.parse(await fs.readFile(path.join(statusDir, file), 'utf8'));
      if (!instance || typeof instance !== 'object' || Array.isArray(instance)
        || instance.name !== match[1] || !phases.has(instance.phase)
        || !Number.isFinite(Date.parse(instance.updated_at))) continue;
      Object.defineProperty(instance, INSTANCE_NUMBER, { value: BigInt(match[2]) });
      instances.push(instance);
    } catch {
      // A partially written, removed, or unreadable file must not hide the team.
    }
  }
  return instances;
}

module.exports = { readTeamRoster, readTeamInstances, INSTANCE_NUMBER };
