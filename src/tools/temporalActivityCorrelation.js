// src/tools/temporalActivityCorrelation.js
// Tool 8: temporal_activity_correlation — cross-correlation matrix.
//
// Resolution order:
//   1. ctx.activityTimestamps[wallet]  — override
//   2. live fetch: for each wallet, for each chain, fetchEOAActivity
//      and resolve each block number to a unix timestamp
//   3. NO_DATA (no provider, no override)

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const { listChains } = require('../config/chains');
const temporal = require('../heuristics/temporalCorrelation');
const fetchers = require('../rpc/fetchers');

const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['wallets'],
  properties: {
    wallets: { type: 'array', items: { type: 'string' }, minItems: 2 },
    chains: { type: 'array', items: { type: 'string' } },
  },
};

function validate(input) {
  if (!input || typeof input !== 'object') {
    throw new SchemaError('temporal_activity_correlation', 'input must be an object');
  }
  if (!Array.isArray(input.wallets) || input.wallets.length < 2) {
    throw new SchemaError(
      'temporal_activity_correlation',
      'wallets must contain at least two addresses',
    );
  }
  return {
    wallets: input.wallets.map((w) => validateAddress(w)),
    chains: input.chains || listChains(),
  };
}

async function handler(input, ctx = {}) {
  const params = validate(input);
  const wallets = params.wallets.map((w) => ({
    wallet: w,
    timestamps: (ctx.activityTimestamps && ctx.activityTimestamps[w]) || [],
  }));

  // If any wallet ended up with zero timestamps, try to fetch from chain.
  const needsFetch = wallets.some((w) => !Array.isArray(w.timestamps) || w.timestamps.length === 0);
  if (needsFetch && ctx.getProvider) {
    for (let i = 0; i < wallets.length; i += 1) {
      if (Array.isArray(wallets[i].timestamps) && wallets[i].timestamps.length > 0) continue;
      const ts = [];
      for (const chain of params.chains) {
        const provider = ctx.getProvider(chain);
        if (!provider) continue;
        try {
          const activity = await fetchers.fetchEOAActivity(ctx, chain, wallets[i].wallet);
          const blockNumbers = Array.from(
            new Set(activity.fundingEdges.map((e) => e.blockNumber).filter((b) => b != null)),
          );
          const tsMap = await fetchers.fetchTimestamps(ctx, chain, blockNumbers);
          for (const edge of activity.fundingEdges) {
            const t = tsMap[edge.blockNumber];
            if (t != null) ts.push(t);
          }
        } catch (_) {
          // continue
        }
      }
      ts.sort((a, b) => a - b);
      wallets[i].timestamps = ts;
    }
  }

  const result = await temporal.run({ wallets }, ctx);
  const evidence = result.evidence || {};
  return {
    wallets: params.wallets,
    chains: params.chains,
    correlationMatrix: evidence.matrix || [],
    topPairs: evidence.topPairs || [],
    timezoneHint: evidence.timezoneHint || 'unknown',
    heatmap: evidence.matrix || [],
    score: result.score,
    fired: result.fired,
    evidence: result.evidence,
  };
}

module.exports = {
  name: 'temporal_activity_correlation',
  description: 'Cross-correlate per-wallet activity timestamps across chains.',
  inputSchema,
  handler,
  validate,
};
