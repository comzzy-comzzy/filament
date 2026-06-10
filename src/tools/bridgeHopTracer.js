// src/tools/bridgeHopTracer.js
// Tool 4: bridge_hop_tracer — directed graph of cross-chain fund flows.

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const tracer = require('../heuristics/bridgeHopTracer');

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
  const edges = (ctx.bridgeEdges && ctx.bridgeEdges[params.wallet]) || [];
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
