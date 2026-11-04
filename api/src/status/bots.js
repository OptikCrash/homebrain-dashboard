const { readAllBotHealth } = require('../checks/bots');

// Bot files are live state: read on demand without polling or snapshot storage.
function createBotsStatus({ read = readAllBotHealth } = {}) {
  return {
    async getStatus() {
      return { bots: await read() };
    },
  };
}

module.exports = { createBotsStatus };
