const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const { createSnapshotStore } = require('../src/db/snapshots');

// Minimal stand-in for PrismaClient that records the calls it gets.
function fakePrisma() {
  const calls = [];
  return {
    calls,
    statusSnapshot: {
      async create(args) {
        calls.push(['create', args]);
        return { id: 1, ...args.data };
      },
      async findMany(args) {
        calls.push(['findMany', args]);
        return [];
      },
    },
  };
}

describe('snapshot store (unit)', () => {
  test('record passes service, status and detail to Prisma', async () => {
    const prisma = fakePrisma();
    const store = createSnapshotStore(prisma);

    await store.record({ service: 'syncthing', status: 'healthy', detail: { folders: 3 } });

    assert.deepEqual(prisma.calls, [
      [
        'create',
        {
          data: {
            service: 'syncthing',
            status: 'healthy',
            detail: { folders: 3 },
            recordedAt: undefined,
          },
        },
      ],
    ]);
  });

  test('record rejects an empty service name', async () => {
    const store = createSnapshotStore(fakePrisma());

    await assert.rejects(store.record({ service: ' ', status: 'healthy' }), TypeError);
  });

  test('record rejects an unknown status', async () => {
    const store = createSnapshotStore(fakePrisma());

    await assert.rejects(store.record({ service: 'syncthing', status: 'down' }), TypeError);
  });

  test('latest returns null when there are no snapshots', async () => {
    const prisma = fakePrisma();
    const store = createSnapshotStore(prisma);

    assert.equal(await store.latest('chopper'), null);
    assert.equal(prisma.calls[0][1].take, 1);
  });
});

// Hits a real Postgres with the migration applied. Skipped unless DATABASE_URL is
// set, so `npm test` still works without a database.
describe('snapshot store (database)', { skip: !process.env.DATABASE_URL && 'DATABASE_URL not set' }, () => {
  // Required lazily: loading @prisma/client needs `prisma generate` to have run.
  const { getPrisma, disconnectPrisma } = require('../src/db/prisma');
  const { snapshots } = require('../src/db/snapshots');
  const service = `test-${process.pid}-${Date.now()}`;

  after(async () => {
    await getPrisma().statusSnapshot.deleteMany({ where: { service } });
    await disconnectPrisma();
  });

  test('inserts a snapshot and reads it back', async () => {
    const detail = { builders: [{ name: 'claude', state: 'running', issue: 3 }] };

    const created = await snapshots.record({ service, status: 'unhealthy', detail });
    const latest = await snapshots.latest(service);

    assert.equal(latest.id, created.id);
    assert.equal(latest.service, service);
    assert.equal(latest.status, 'unhealthy');
    assert.deepEqual(latest.detail, detail);
    assert.ok(latest.recordedAt instanceof Date);
  });

  test('history is newest first and honours since/limit', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const t1 = new Date('2026-01-01T01:00:00Z');
    const t2 = new Date('2026-01-01T02:00:00Z');
    await snapshots.record({ service, status: 'healthy', recordedAt: t0 });
    await snapshots.record({ service, status: 'unknown', recordedAt: t1 });
    await snapshots.record({ service, status: 'healthy', recordedAt: t2 });

    const sinceT1 = await snapshots.history(service, { since: t1, limit: 10 });
    const times = sinceT1.map((row) => row.recordedAt.getTime());
    assert.ok(times.every((t) => t >= t1.getTime()));
    assert.deepEqual(times, [...times].sort((a, b) => b - a));

    const limited = await snapshots.history(service, { limit: 1 });
    assert.equal(limited.length, 1);
  });
});
