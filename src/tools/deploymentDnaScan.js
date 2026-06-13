// src/tools/deploymentDnaScan.js
// Tool 3: deployment_dna_scan — constructor bytecode DNA match.
//
// Resolution order:
//   1. ctx.deployments[wallet]  — override
//   2. live fetch: for each configured chain, fetchDeployments
//   3. NO_DATA (no provider, no override)

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const { listChains } = require('../config/chains');
const dna = require('../heuristics/deploymentDna');
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
    throw new SchemaError('deployment_dna_scan', 'input must be an object');
  }
  validateAddress(input.wallet);
  return { wallet: input.wallet, chains: input.chains || listChains() };
}

async function handler(input, ctx = {}) {
  const params = validate(input);
  let deployments = (ctx.deployments && ctx.deployments[params.wallet]) || [];

  if (deployments.length === 0 && ctx.getProvider) {
    const live = [];
    for (const chain of params.chains) {
      const provider = ctx.getProvider(chain);
      if (!provider) continue;
      try {
        const ds = await fetchers.fetchDeployments(ctx, chain, params.wallet);
        live.push(...ds);
      } catch (_) {
        // continue
      }
    }
    deployments = live;
  }

  const result = await dna.run({ deployments }, ctx);
  return {
    wallet: params.wallet,
    fingerprint:
      result.evidence && result.evidence.topFingerprint
        ? result.evidence.topFingerprint
        : null,
    matchedWallets: result.evidence && result.evidence.topCount ? result.evidence.topCount : 0,
    similarity: result.score,
    evidence: result.evidence,
    fired: result.fired,
  };
}

module.exports = {
  name: 'deployment_dna_scan',
  description: 'Extract and match cross-chain deployment DNA.',
  inputSchema,
  handler,
  validate,
};
