// src/server.js
// Filament MCP server entry point.
//
// Responsibilities:
//   1. Load configuration from .env via dotenv.
//   2. Construct the shared context (provider, cache, rate limiter).
//   3. Register the eleven tool adapters with the MCP SDK.
//   4. Connect to the selected transport and run:
//        - stdio (default) when MCP_TRANSPORT is not "sse"
//        - SSE     when MCP_TRANSPORT=sse (Express on PORT, /sse + /messages + /health)

'use strict';

require('dotenv').config();

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const express = require('express');
const cors = require('cors');

const { TOOLS, getTool } = require('./tools');
const { TtlCache } = require('./utils/cache');
const { RateLimiter } = require('./utils/rateLimit');
const { getProvider } = require('./rpc/provider');
const { listConfiguredChains } = require('./rpc/provider');

const RATE_LIMIT_MS = Number(process.env.RATE_LIMIT_MS || 200);
const MAX_GRAPH_DEPTH = Number(process.env.MAX_GRAPH_DEPTH || 3);
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || 300);
const PORT = Number(process.env.PORT || 3008);
const MCP_TRANSPORT = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();

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

async function runStdio() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // The MCP SDK takes ownership of the transport lifecycle; we simply
  // keep the process alive until stdio closes.
  process.stdin.resume();
}

async function runSse() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '4mb' }));

  // Map of sessionId -> SSEServerTransport so we can route inbound
  // POST /messages?sessionId=... to the right SSE stream.
  const transports = new Map();

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      transport: ['stdio', 'sse'],
      tools: 11,
    });
  });

  app.get('/sse', async (req, res) => {
    // The SDK writes SSE headers and the `endpoint` event to `res`
    // during start(); we just need to keep the response alive.
    const transport = new SSEServerTransport('/messages', res);
    transports.set(transport.sessionId, transport);
    transport.onclose = () => {
      transports.delete(transport.sessionId);
    };
    res.on('close', () => {
      transports.delete(transport.sessionId);
    });

    const server = buildServer();
    await server.connect(transport);
  });

  app.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId;
    if (!sessionId || typeof sessionId !== 'string') {
      res.status(400).json({ error: 'missing sessionId query parameter' });
      return;
    }
    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: `no active SSE session for sessionId=${sessionId}` });
      return;
    }
    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (err) {
      // handlePostMessage writes its own error responses in most cases;
      // this catch is a safety net for unexpected throws.
      if (!res.headersSent) {
        res.status(500).json({ error: err && err.message ? err.message : 'internal error' });
      }
    }
  });

  await new Promise((resolve, reject) => {
    const server = app.listen(PORT, (err) => {
      if (err) return reject(err);
      resolve();
    });
    server.on('error', reject);
  });

  // eslint-disable-next-line no-console
  console.log(`Filament MCP server running on http://localhost:${PORT}/sse`);
}

async function main() {
  if (MCP_TRANSPORT === 'sse') {
    await runSse();
    return;
  }
  await runStdio();
}

if (require.main === module) {
  main().catch((err) => {
    // Surface a fatal startup error to stderr and exit non-zero. Avoid
    // throwing further — the MCP transport has no way to recover us.
    process.stderr.write(`filament: fatal startup error: ${err && err.stack || err}\n`);
    process.exit(1);
  });
}

module.exports = { buildServer, buildContext, main, runStdio, runSse };
