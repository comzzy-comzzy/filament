// src/tools/deploymentDnaScan.js
// Tool 3: deployment_dna_scan — constructor bytecode DNA match.

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const dna = require('../heuristics/deploymentDna');

const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['wallet'],
  properties: {
    wallet: { type: 'string' },
  },
};

function validate(input) {
  if (!input || typeof input !== 'object') {
    throw new SchemaError('deployment_dna_scan', 'input must be an object');
  }
  return { wallet: validateAddress(input.wallet) };
}

async function handler(input, ctx = {}) {
  const params = validate(input);
  const deployments = (ctx.deployments && ctx.deployments[params.wallet]) || [];
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
