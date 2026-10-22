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
      async groupBy(args) {
        calls.push(['groupBy', args]);
        return [{ service: 'dev-builders:claude' }, { service: 'dev-builders:codex' }];
      },
    },
  };
}

describe('snapshot store (unit)', () => {
  test('services groups and sorts service names in the database', async () => {
    const prisma = fakePrisma();
    const store = createSnapshotStore(prisma);

    assert.deepEqual(await store.services('dev-builders:'), [
      'dev-builders:claude', 'dev-builders:codex',
    ]);
    assert.deepEqual(prisma.calls, [['groupBy', {
      by: ['service'],
      where: { service: { startsWith: 'dev-builders:' } },
      orderBy: { service: 'asc' },
    }]]);
  });

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
    await getPrisma().statusSnapshot.deleteMany({ where: { service: { startsWith: service } } });
    await disconnectPrisma();
  });

  test('service discovery transfers only grouped names with substantial duplicate history', async () => {
    const prefix = `${service}:builders:`;
    const names = [`${prefix}claude`, `${prefix}codex`];
    const model = getPrisma().statusSnapshot;
    const transferred = [];
    const store = createSnapshotStore({ statusSnapshot: {
      async groupBy(args) {
        const rows = await model.groupBy(args);
        transferred.push(rows.length);
        return rows;
      },
    } });
    assert.deepEqual(await store.services(prefix), []);
    await model.createMany({ data: names.map((name) => ({ service: name, status: 'healthy' })) });
    assert.deepEqual(await store.services(prefix), names);
    await model.createMany({
      data: Array.from({ length: 10000 }, (_, i) => ({ service: names[i % 2], status: 'healthy' })),
    });
    await model.create({ data: { service: `${service}:other`, status: 'unknown' } });
    assert.equal(await model.count({ where: { service: { startsWith: prefix } } }), 10002);
    assert.deepEqual(await store.services(prefix), names);
    assert.deepEqual(transferred, [0, 2, 2]);
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
