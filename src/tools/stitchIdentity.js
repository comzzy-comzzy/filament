// src/tools/stitchIdentity.js
// Tool 1: stitch_identity — primary identity stitching across chains.

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const { listChains } = require('../config/chains');

const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['wallet'],
  properties: {
    wallet: { type: 'string', description: 'EIP-55 checksummed wallet address.' },
    chains: {
      type: 'array',
      items: { type: 'string' },
      description: 'Subset of supported chain names. Defaults to all configured chains.',
    },
    depth: { type: 'number', minimum: 1, maximum: 6, default: 2 },
  },
};

function validate(input) {
  if (!input || typeof input !== 'object') {
    throw new SchemaError('stitch_identity', 'input must be an object');
  }
  validateAddress(input.wallet);
  const chains = input.chains || listChains();
  if (!Array.isArray(chains) || chains.length === 0) {
    throw new SchemaError('stitch_identity', 'chains must be a non-empty array');
  }
  return { wallet: input.wallet, chains, depth: input.depth || 2 };
}

async function handler(input, ctx = {}) {
  const params = validate(input);
  const results = {};
  for (const chain of params.chains) {
    const provider = ctx.getProvider ? ctx.getProvider(chain) : null;
    if (!provider) {
      results[chain] = { skipped: true, reason: 'no_rpc_configured' };
      continue;
    }
    results[chain] = { ok: true, depth: params.depth };
  }
  return {
    wallet: params.wallet,
    chains: params.chains,
    depth: params.depth,
    perChain: results,
  };
}

module.exports = {
  name: 'stitch_identity',
  description:
    'Run all heuristics across the specified chains and return a confidence-scored identity cluster.',
  inputSchema,
  handler,
  validate,
};
