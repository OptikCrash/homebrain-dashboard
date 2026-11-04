const net = require('node:net');
function port(value = process.env.PORT ?? '8090') {
  if (!/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return Number(value);
}
function reserve(value) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`API: 127.0.0.1:${value} is unavailable; free the port or stop the other listener.`)));
    server.listen(value, '127.0.0.1', () => resolve(server));
  });
}
module.exports = { port, reserve };
