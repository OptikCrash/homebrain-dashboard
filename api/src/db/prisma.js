// One PrismaClient per process. Created (and @prisma/client loaded) on first use,
// so the app and tests that don't touch the database start without DATABASE_URL
// or a generated client.
let client;

function getPrisma() {
  if (!client) {
    const { PrismaClient } = require('@prisma/client');
    client = new PrismaClient();
  }
  return client;
}

async function disconnectPrisma() {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}

module.exports = { getPrisma, disconnectPrisma };
