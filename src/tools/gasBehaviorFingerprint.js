// src/tools/gasBehaviorFingerprint.js
// Tool 5: gas_behavior_fingerprint — gas bidding style signature.

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const { listChains } = require('../config/chains');
const gas = require('../heuristics/gasBehavior');

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
    throw new SchemaError('gas_behavior_fingerprint', 'input must be an object');
  }
  validateAddress(input.wallet);
  return { wallet: input.wallet, chains: input.chains || listChains() };
}

async function handler(input, ctx = {}) {
  const params = validate(input);
  const samplesByChain = {};
  for (const chain of params.chains) {
    samplesByChain[chain] =
      (ctx.gasSamples && ctx.gasSamples[chain] && ctx.gasSamples[chain][params.wallet]) ||
      [];
  }
  const result = await gas.run({ samplesByChain }, ctx);
  return {
    wallet: params.wallet,
    chains: params.chains,
    signature: result.evidence && result.evidence.summaries ? result.evidence.summaries : null,
    similarity: result.score,
    biddingStyle:
      result.score > 0.8 ? 'fast' : result.score > 0.4 ? 'moderate' : 'conservative',
    evidence: result.evidence,
    fired: result.fired,
  };
}

module.exports = {
  name: 'gas_behavior_fingerprint',
  description: 'Profile gas bidding behaviour across chains for a behavioural signature.',
  inputSchema,
  handler,
  validate,
};
