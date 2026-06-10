// examples/_fakeMcpClient.js
// In-process MCP client. Imports the tool adapters directly so the example
// scripts can run without spinning up an MCP transport. The interface
// mirrors what a real MCP client would expose.

const { getTool } = require('../src/tools');
const { listConfiguredChains, getProvider } = require('../src/rpc/provider');
const { TtlCache } = require('../src/utils/cache');
const { RateLimiter } = require('../src/utils/rateLimit');

class FakeMcpClient {
  constructor(ctxOverrides = {}) {
    const env = process.env;
    this.cache = new TtlCache({
      ttlSeconds: Number(env.CACHE_TTL_SECONDS || 300),
    });
    this.rateLimit = new RateLimiter({
      intervalMs: Number(env.RATE_LIMIT_MS || 0),
    });
    this.ctx = {
      getProvider: (chain) => getProvider(chain),
      configuredChains: listConfiguredChains(),
      cache: this.cache,
      rateLimit: this.rateLimit,
      ...ctxOverrides,
    };
  }

  async callTool(name, args) {
    const tool = getTool(name);
    if (!tool) {
      throw new Error(`unknown tool: ${name}`);
    }
    return tool.handler(args || {}, this.ctx);
  }

  printResult(label, value) {
    process.stdout.write(`\n--- ${label} ---\n`);
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }
}

module.exports = { FakeMcpClient };
