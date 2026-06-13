// src/tools/entropyAddressScorer.js
// Tool 9: entropy_address_scorer — detect low-entropy derived addresses.
//
// Resolution order:
//   1. input.addresses (explicit list passed by caller)
//   2. ctx.childAddresses[wallet]  — override
//   3. live fetch: collect token-contract counterparts from fetchEOAActivity
//      across the configured chains, treat those as "child" interactions
//   4. NO_DATA (no provider, no override)

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const { listChains } = require('../config/chains');
const entropy = require('../heuristics/entropyScorer');
const fetchers = require('../rpc/fetchers');

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
    chains: { type: 'array', items: { type: 'string' } },
  },
};

function validate(input) {
  if (!input || typeof input !== 'object') {
    throw new SchemaError('entropy_address_scorer', 'input must be an object');
  }
  return {
    wallet: validateAddress(input.wallet),
    addresses: input.addresses || null,
    chains: input.chains || listChains(),
  };
}

async function handler(input, ctx = {}) {
  const params = validate(input);
  let addresses = params.addresses || (ctx.childAddresses && ctx.childAddresses[params.wallet]) || [];

  if ((!addresses || addresses.length < 2) && ctx.getProvider) {
    // Best-effort: pull counterparties from the wallet's EOA activity.
    const collected = new Set();
    for (const chain of params.chains) {
      const provider = ctx.getProvider(chain);
      if (!provider) continue;
      try {
        const activity = await fetchers.fetchEOAActivity(ctx, chain, params.wallet);
        for (const e of activity.fundingEdges) {
          if (e.from && e.from !== activity.wallet) collected.add(e.from);
          if (e.to && e.to !== activity.wallet) collected.add(e.to);
        }
      } catch (_) {
        // continue
      }
    }
    addresses = Array.from(collected);
  }

  const result = await entropy.run({ addresses: addresses || [] }, ctx);
  const evidence = result.evidence || {};
  const repeated = evidence.repeatedByteAddresses || 0;
  return {
    wallet: params.wallet,
    entropyScore: result.score,
    flaggedAddresses: repeated > 0 ? addresses : [],
    patterns:
      evidence.reason === 'no_data'
        ? null
        : {
            sequentialPairs: evidence.sequentialPairs || 0,
            repeatedByteAddresses: repeated,
            meanEntropy: evidence.meanEntropy || 0,
          },
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
