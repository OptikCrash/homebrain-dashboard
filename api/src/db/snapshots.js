const { getPrisma } = require('./prisma');

const STATUSES = ['healthy', 'unhealthy', 'unknown'];
const DEFAULT_LIMIT = 100;

// Read/write access to status snapshots. Takes a Prisma client so tests can pass
// a fake; the rest of the API should use the default `snapshots` export below.
function createSnapshotStore(prisma) {
  // Stores one snapshot and returns the created row.
  async function record({ service, status, detail, recordedAt } = {}) {
    if (typeof service !== 'string' || service.trim() === '') {
      throw new TypeError('service must be a non-empty string');
    }
    if (!STATUSES.includes(status)) {
      throw new TypeError(`status must be one of: ${STATUSES.join(', ')}`);
    }

    return prisma.statusSnapshot.create({
      data: {
        service,
        status,
        detail: detail ?? undefined,
        recordedAt: recordedAt ?? undefined,
      },
    });
  }

  // Snapshots for one service, newest first. `since` limits to rows at or after
  // that time.
  async function history(service, { since, limit = DEFAULT_LIMIT } = {}) {
    return prisma.statusSnapshot.findMany({
      where: {
        service,
        ...(since ? { recordedAt: { gte: since } } : {}),
      },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  // Most recent snapshot for one service, or null if it has none yet.
  async function latest(service) {
    const [row] = await history(service, { limit: 1 });
    return row ?? null;
  }

  async function services(prefix) {
    // groupBy deduplicates in SQL, so only one row per service crosses the
    // database connection even as snapshot history grows.
    const rows = await prisma.statusSnapshot.groupBy({
      by: ['service'],
      where: { service: { startsWith: prefix } },
      orderBy: { service: 'asc' },
    });
    return rows.map((row) => row.service);
  }

  return { record, history, latest, services };
}

// Lazily bound to the shared client so importing this module never opens a
// connection by itself.
const snapshots = createSnapshotStore({
  get statusSnapshot() {
    return getPrisma().statusSnapshot;
  },
});

module.exports = { STATUSES, createSnapshotStore, snapshots };
