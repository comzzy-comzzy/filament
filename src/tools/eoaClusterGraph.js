// src/tools/eoaClusterGraph.js
// Tool 6: eoa_cluster_graph — adjacency list with edge weights.
//
// Resolution order:
//   1. ctx.fundingEdges[wallet]  — override (preserves example/test contract)
//   2. live fetch via fetchEOAActivity per chain, merged
//   3. NO_DATA (no provider, no override)

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const { listChains } = require('../config/chains');
const cluster = require('../heuristics/eoaClusterGraph');
const fetchers = require('../rpc/fetchers');

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
  let edges = (ctx.fundingEdges && ctx.fundingEdges[params.wallet]) || [];

  // If no override, fetch from each configured chain.
  if (edges.length === 0) {
    const liveEdges = [];
    for (const chain of params.chains) {
      const provider = ctx.getProvider ? ctx.getProvider(chain) : null;
      if (!provider) continue;
      try {
        const activity = await fetchers.fetchEOAActivity(ctx, chain, params.wallet);
        if (params.depth > 1 && activity.fundingEdges.length > 0) {
          const expanded = await fetchers.expandCluster(
            ctx,
            chain,
            params.wallet,
            params.depth,
            activity.fundingEdges,
          );
          liveEdges.push(...expanded);
        } else {
          liveEdges.push(...activity.fundingEdges);
        }
      } catch (_) {
        // continue with what we have
      }
    }
    edges = liveEdges;
  }

  const result = await cluster.run({ edges }, ctx);
  const reciprocity = (result.evidence && result.evidence.reciprocity) || [];
  return {
    wallet: params.wallet,
    depth: params.depth,
    chains: params.chains,
    adjacency: edges,
    edges,
    clusterSize: (result.evidence && result.evidence.edges) || 0,
    centralCandidates: reciprocity
      .filter((r) => r.mutual > 0)
      .sort((a, b) => b.mutual - a.mutual)
      .slice(0, 5),
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
