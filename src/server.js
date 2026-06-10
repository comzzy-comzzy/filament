// src/server.js
// Filament MCP server entry point.
//
// Responsibilities:
//   1. Load configuration from .env via dotenv.
//   2. Construct the shared context (provider, cache, rate limiter).
//   3. Register the eleven tool adapters with the MCP SDK.
//   4. Connect to the stdio transport and run until stdin closes.

'use strict';

require('dotenv').config();

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const { TOOLS, getTool } = require('./tools');
const { TtlCache } = require('./utils/cache');
const { RateLimiter } = require('./utils/rateLimit');
const { getProvider } = require('./rpc/provider');
const { listConfiguredChains } = require('./rpc/provider');

const RATE_LIMIT_MS = Number(process.env.RATE_LIMIT_MS || 200);
const MAX_GRAPH_DEPTH = Number(process.env.MAX_GRAPH_DEPTH || 3);
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || 300);

const cache = new TtlCache({ ttlSeconds: CACHE_TTL_SECONDS });
const rateLimit = new RateLimiter({ intervalMs: RATE_LIMIT_MS });

function buildContext() {
  return {
    getProvider: (chain) => getProvider(chain),
    cache,
    rateLimit,
    config: {
      rateLimitMs: RATE_LIMIT_MS,
      maxGraphDepth: MAX_GRAPH_DEPTH,
      cacheTtlSeconds: CACHE_TTL_SECONDS,
    },
    configuredChains: listConfiguredChains(),
  };
}

function buildServer() {
  const server = new Server(
    {
      name: 'filament',
      version: '0.1.0',
    },
    {
      capabilities: { tools: {} },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params || {};
    const tool = getTool(name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `unknown_tool: ${name}` }) }],
        isError: true,
      };
    }
    const ctx = buildContext();
    try {
      const result = await tool.handler(args || {}, ctx);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: false,
      };
    } catch (err) {
      const payload = {
        error: err.name || 'Error',
        message: err.message,
        detail: err.cause ? String(err.cause.message || err.cause) : null,
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        isError: true,
      };
    }
  });

  return server;
}

async function main() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // The MCP SDK takes ownership of the transport lifecycle; we simply
  // keep the process alive until stdio closes.
  process.stdin.resume();
}

if (require.main === module) {
  main().catch((err) => {
    // Surface a fatal startup error to stderr and exit non-zero. Avoid
    // throwing further — the MCP transport has no way to recover us.
    process.stderr.write(`filament: fatal startup error: ${err && err.stack || err}\n`);
    process.exit(1);
  });
}

module.exports = { buildServer, buildContext, main };
