// tests/fixtures/rpcMock.js
// Lightweight in-memory mocks for the network-facing surfaces of Filament.

const { TtlCache } = require('../../src/utils/cache');
const { RateLimiter } = require('../../src/utils/rateLimit');

function makeMockProvider({ responses = {}, failNext = 0 } = {}) {
  let calls = 0;
  const failures = [];
  return {
    calls: () => calls,
    failures: () => failures.slice(),
    async send(method, params) {
      calls += 1;
      if (failNext > 0) {
        failNext -= 1;
        const err = new Error(`mock transient failure for ${method}`);
        err.code = 'ECONNRESET';
        failures.push(err);
        throw err;
      }
      const key = `${method}:${JSON.stringify(params || [])}`;
      if (Object.prototype.hasOwnProperty.call(responses, key)) {
        return responses[key];
      }
      if (Object.prototype.hasOwnProperty.call(responses, method)) {
        return responses[method];
      }
      return null;
    },
  };
}

function makeContext(overrides = {}) {
  return {
    cache: new TtlCache({ ttlSeconds: 1 }),
    rateLimit: new RateLimiter({ intervalMs: 0 }),
    getProvider: () => null,
    configuredChains: [],
    ...overrides,
  };
}

function makeWallet(seed = '0xa11ce') {
  // Pad a short seed into a valid 0x + 40 hex string and checksum it.
  const body = seed.replace(/^0x/i, '').toLowerCase().padEnd(40, '0').slice(0, 40);
  const { toChecksumAddress } = require('../../src/utils/checksum');
  return toChecksumAddress(`0x${body}`);
}

module.exports = { makeMockProvider, makeContext, makeWallet };
