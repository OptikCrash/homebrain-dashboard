const { readTeamRoster, readTeamInstances, INSTANCE_NUMBER } = require('../checks/team');

const nonTerminal = new Set(['starting', 'building', 'pushing', 'reviewing']);
// Explicit public fields: never expose host process IDs, log paths, or future metadata.
const activeFields = new Set([
  'instance', 'name', 'title', 'engine', 'kind', 'issue', 'pr', 'branch',
  'phase', 'started_at', 'updated_at', 'result',
]);

const terminal = new Set(['done', 'failed', 'no-changes', 'stopped']);

function createTeamStatus({ roster = readTeamRoster, instances = readTeamInstances } = {}) {
  async function getStatus() {
    const [members, jobs] = await Promise.all([roster(), instances()]);
    const latest = new Map();
    for (const job of jobs) {
      const previous = latest.get(job.name);
      if (!previous || job[INSTANCE_NUMBER] > previous[INSTANCE_NUMBER]) latest.set(job.name, job);
    }
    return {
      roster: members.map((member) => ({
        ...member,
        status: nonTerminal.has(latest.get(member.name)?.phase) ? 'active' : 'idle',
      })),
      active: [...latest.values()].filter((job) => nonTerminal.has(job.phase))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((job) => Object.fromEntries(Object.entries(job).filter(([key]) => activeFields.has(key)))),
      recent: jobs.filter((job) => terminal.has(job.phase))
        .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
        .slice(0, 5)
        .map(({ name, title, issue, pr, phase, result, updated_at }) =>
          ({ name, title, issue, pr, phase, result, updated_at })),
    };
  }
  return { getStatus };
}

module.exports = { createTeamStatus };
