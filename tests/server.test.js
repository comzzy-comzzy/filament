// tests/server.test.js
// MCP server contract tests for the shared server builder.

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

const { buildContext, buildServer } = require('../src/server');
const { listToolNames } = require('../src/tools');

describe('server MCP contract', () => {
  test('buildContext exposes configured chain metadata and shared controls', () => {
    const ctx = buildContext();

    expect(typeof ctx.getProvider).toBe('function');
    expect(ctx.cache).toBeDefined();
    expect(ctx.rateLimit).toBeDefined();
    expect(ctx.config).toEqual(
      expect.objectContaining({
        rateLimitMs: expect.any(Number),
        maxGraphDepth: expect.any(Number),
        cacheTtlSeconds: expect.any(Number),
      }),
    );
    expect(Array.isArray(ctx.configuredChains)).toBe(true);
  });

  test('buildServer lists all registered tools over MCP', async () => {
    const server = buildServer();
    const client = new Client({ name: 'server-test', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.listTools();
      expect(result.tools.map((tool) => tool.name).sort()).toEqual(listToolNames().sort());
    } finally {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });

  test('buildServer returns JSON tool content for calls', async () => {
    const server = buildServer();
    const client = new Client({ name: 'server-test', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: 'entropy_address_scorer',
        arguments: {
          wallet: '0x000000000000000000000000000000000000a11e',
          addresses: [
            '0x1111111111111111111111111111111111111111',
            '0x2222222222222222222222222222222222222222',
          ],
        },
      });

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      const payload = JSON.parse(result.content[0].text);
      expect(payload.wallet).toBe('0x000000000000000000000000000000000000A11E');
      expect(payload.fired).toBe(true);
    } finally {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });
});
