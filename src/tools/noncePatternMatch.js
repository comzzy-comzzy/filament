// src/tools/noncePatternMatch.js
// Tool 2: nonce_pattern_match — temporal fingerprint similarity.

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const { listChains } = require('../config/chains');
const nonce = require('../heuristics/noncePattern');

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
    const provider = ctx.getProvider ? ctx.getProvider(chain) : null;
    if (!provider) {
      seriesByChain[chain] = [];
      continue;
    }
    const override = ctx.nonceSeries && ctx.nonceSeries[chain];
    seriesByChain[chain] = override || [];
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
