// src/tools/bridgeHopTracer.js
// Tool 4: bridge_hop_tracer — directed graph of cross-chain fund flows.
//
// Resolution order:
//   1. ctx.bridgeEdges[wallet]  — override
//   2. live fetch via fetchBridgeInteractions per chain
//   3. NO_DATA (no provider, no override)

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const tracer = require('../heuristics/bridgeHopTracer');
const fetchers = require('../rpc/fetchers');

const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['wallet'],
  properties: {
    wallet: { type: 'string' },
    depth: { type: 'number', minimum: 1, maximum: 6, default: 2 },
  },
};

function validate(input) {
  if (!input || typeof input !== 'object') {
    throw new SchemaError('bridge_hop_tracer', 'input must be an object');
  }
  return { wallet: validateAddress(input.wallet), depth: input.depth || 2 };
}

async function handler(input, ctx = {}) {
  const params = validate(input);
  let edges = (ctx.bridgeEdges && ctx.bridgeEdges[params.wallet]) || [];

  if (edges.length === 0 && ctx.getProvider) {
    const liveEdges = [];
    const chains = (ctx.configuredChains && ctx.configuredChains.length > 0)
      ? ctx.configuredChains
      : ['ethereum', 'arbitrum', 'optimism', 'base', 'polygon', 'bnb', 'mantle'];
    for (const chain of chains) {
      const provider = ctx.getProvider(chain);
      if (!provider) continue;
      try {
        const bridgeHits = await fetchers.fetchBridgeInteractions(ctx, chain, params.wallet);
        liveEdges.push(...bridgeHits);
      } catch (_) {
        // continue
      }
    }
    edges = liveEdges;
  }

  const result = await tracer.run({ edges }, ctx);
  const nodes = new Set();
  for (const e of edges) {
    if (e && e.from) nodes.add(e.from);
    if (e && e.to) nodes.add(e.to);
  }
  return {
    wallet: params.wallet,
    depth: params.depth,
    graph: { nodes: Array.from(nodes), edges },
    score: result.score,
    evidence: result.evidence,
    fired: result.fired,
  };
}

module.exports = {
  name: 'bridge_hop_tracer',
  description: 'Follow bridge interactions across Stargate, Across, Hop, and LayerZero.',
  inputSchema,
  handler,
  validate,
};
