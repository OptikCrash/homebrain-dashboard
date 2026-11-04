const { getPrisma } = require('./prisma');
const { isNewCompletedRun } = require('../checks/backup');

function createBackupRunStore(prisma) {
  async function history({ limit = 10 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Invalid backup history limit');
    return prisma.backupRunSnapshot.findMany({ orderBy: { finishedAt: 'desc' }, take: limit });
  }

  async function record(run) {
    if (!isNewCompletedRun(run)) throw new TypeError('Invalid completed backup run');
    const [latest] = await history({ limit: 1 });
    if (!isNewCompletedRun(run, latest?.finishedAt ?? null)) return;
    await prisma.backupRunSnapshot.createMany({
      data: [{ state: run.state, finishedAt: new Date(run.finished_at),
        snapshotId: run.snapshot_id, bytesAdded: run.bytes_added == null ? null : BigInt(run.bytes_added),
        detail: run }],
      skipDuplicates: true,
    });
  }
  return { history, record };
}
const backupRuns = createBackupRunStore({
  get backupRunSnapshot() { return getPrisma().backupRunSnapshot; },
});
module.exports = { createBackupRunStore, backupRuns };
