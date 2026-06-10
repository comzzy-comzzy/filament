// src/tools/eoaClusterGraph.js
// Tool 6: eoa_cluster_graph — adjacency list with edge weights.

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const { listChains } = require('../config/chains');
const cluster = require('../heuristics/eoaClusterGraph');

const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['wallet'],
  properties: {
    wallet: { type: 'string' },
    chains: { type: 'array', items: { type: 'string' } },
    depth: { type: 'number', minimum: 1, maximum: 6, default: 2 },
  },
};

function validate(input) {
  if (!input || typeof input !== 'object') {
    throw new SchemaError('eoa_cluster_graph', 'input must be an object');
  }
  validateAddress(input.wallet);
  return {
    wallet: input.wallet,
    chains: input.chains || listChains(),
    depth: input.depth || 2,
  };
}

async function handler(input, ctx = {}) {
  const params = validate(input);
  const edges = (ctx.fundingEdges && ctx.fundingEdges[params.wallet]) || [];
  const result = await cluster.run({ edges }, ctx);
  return {
    wallet: params.wallet,
    depth: params.depth,
    chains: params.chains,
    adjacency: edges,
    edges,
    clusterSize: result.evidence ? result.evidence.edges : 0,
    centralCandidates: result.evidence
      ? result.evidence.reciprocity
          .filter((r) => r.mutual > 0)
          .sort((a, b) => b.mutual - a.mutual)
          .slice(0, 5)
      : [],
    score: result.score,
    fired: result.fired,
    evidence: result.evidence,
  };
}

module.exports = {
  name: 'eoa_cluster_graph',
  description: 'Build the funded/funder adjacency graph and surface central wallets.',
  inputSchema,
  handler,
  validate,
};
