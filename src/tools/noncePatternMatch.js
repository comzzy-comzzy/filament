// src/tools/noncePatternMatch.js
// Tool 2: nonce_pattern_match — temporal fingerprint similarity.
//
// Resolution order:
//   1. ctx.nonceSeries[chain] (test/example override)  — used verbatim
//   2. live fetch via the onchain fetchers (provider.getBlockNumber + getLogs)
//   3. NO_DATA (no provider, no override)

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const { listChains } = require('../config/chains');
const nonce = require('../heuristics/noncePattern');
const fetchers = require('../rpc/fetchers');

const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['wallet'],
  properties: {
    wallet: { type: 'string' },
    chains: { type: 'array', items: { type: 'string' } },
  },
};

function validate(input) {
  if (!input || typeof input !== 'object') {
    throw new SchemaError('nonce_pattern_match', 'input must be an object');
  }
  validateAddress(input.wallet);
  return { wallet: input.wallet, chains: input.chains || listChains() };
}

async function handler(input, ctx = {}) {
  const params = validate(input);
  const seriesByChain = {};

  for (const chain of params.chains) {
    // 1. Honor the test/example override first.
    const override = ctx.nonceSeries && ctx.nonceSeries[chain];
    if (override && Array.isArray(override)) {
      seriesByChain[chain] = override;
      continue;
    }
    // 2. Try to fetch from chain. Returns empty bag if no provider.
    const provider = ctx.getProvider ? ctx.getProvider(chain) : null;
    if (!provider) {
      seriesByChain[chain] = [];
      continue;
    }
    try {
      const activity = await fetchers.fetchEOAActivity(ctx, chain, params.wallet);
      const blockNumbers = Array.from(
        new Set(activity.fundingEdges.map((e) => e.blockNumber).filter((b) => b != null)),
      );
      const tsMap = await fetchers.fetchTimestamps(ctx, chain, blockNumbers);
      const timestamps = [];
      for (const edge of activity.fundingEdges) {
        const ts = tsMap[edge.blockNumber];
        if (ts != null) timestamps.push(ts);
      }
      timestamps.sort((a, b) => a - b);
      seriesByChain[chain] = timestamps;
    } catch (_) {
      seriesByChain[chain] = [];
    }
  }

  const result = await nonce.run({ seriesByChain }, ctx);
  return {
    wallet: params.wallet,
    chains: params.chains,
    similarity: result.score,
    pattern:
      result.evidence && result.evidence.meanGapSeconds
        ? result.evidence.meanGapSeconds
        : null,
    fired: result.fired,
    evidence: result.evidence,
  };
}

module.exports = {
  name: 'nonce_pattern_match',
  description:
    'Compare per-chain nonce sequences to score temporal fingerprint similarity.',
  inputSchema,
  handler,
  validate,
};
