// src/tools/entropyAddressScorer.js
// Tool 9: entropy_address_scorer — detect low-entropy derived addresses.

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const entropy = require('../heuristics/entropyScorer');

const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['wallet'],
  properties: {
    wallet: { type: 'string' },
    addresses: {
      type: 'array',
      items: { type: 'string' },
      description: 'Child addresses to score. Defaults to ctx.childAddresses[wallet].',
    },
  },
};

function validate(input) {
  if (!input || typeof input !== 'object') {
    throw new SchemaError('entropy_address_scorer', 'input must be an object');
  }
  return { wallet: validateAddress(input.wallet), addresses: input.addresses || null };
}

async function handler(input, ctx = {}) {
  const params = validate(input);
  const addresses =
    params.addresses || (ctx.childAddresses && ctx.childAddresses[params.wallet]) || [];
  const result = await entropy.run({ addresses }, ctx);
  return {
    wallet: params.wallet,
    entropyScore: result.score,
    flaggedAddresses:
      result.evidence && result.evidence.repeatedByteAddresses > 0 ? addresses : [],
    patterns: result.evidence
      ? {
          sequentialPairs: result.evidence.sequentialPairs,
          repeatedByteAddresses: result.evidence.repeatedByteAddresses,
          meanEntropy: result.evidence.meanEntropy,
        }
      : null,
    derivationHypothesis:
      result.score > 0.5
        ? 'vanity_or_sequential_generator'
        : result.score > 0.2
          ? 'biased_derivation'
          : 'standard_hd_wallet',
    fired: result.fired,
    evidence: result.evidence,
  };
}

module.exports = {
  name: 'entropy_address_scorer',
  description: 'Score child addresses for low-entropy derivation patterns.',
  inputSchema,
  handler,
  validate,
};
