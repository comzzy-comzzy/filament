// src/tools/contractInteractionOverlap.js
// Tool 7: contract_interaction_overlap — obscure-contract overlap score.

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const overlap = require('../heuristics/contractOverlap');

const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['walletA', 'walletB'],
  properties: {
    walletA: { type: 'string' },
    walletB: { type: 'string' },
  },
};

function validate(input) {
  if (!input || typeof input !== 'object') {
    throw new SchemaError('contract_interaction_overlap', 'input must be an object');
  }
  return {
    walletA: validateAddress(input.walletA),
    walletB: validateAddress(input.walletB),
  };
}

async function handler(input, ctx = {}) {
  const params = validate(input);
  const interactionsA = (ctx.interactions && ctx.interactions[params.walletA]) || [];
  const interactionsB = (ctx.interactions && ctx.interactions[params.walletB]) || [];
  const result = await overlap.run(
    { walletA: { interactions: interactionsA }, walletB: { interactions: interactionsB } },
    ctx,
  );
  const aSet = new Set(interactionsA.map((i) => String(i.address).toLowerCase()));
  const shared = interactionsB
    .map((i) => String(i.address).toLowerCase())
    .filter((a) => aSet.has(a));
  return {
    walletA: params.walletA,
    walletB: params.walletB,
    overlapScore: result.score,
    sharedContracts: Array.from(new Set(shared)),
    jaccard: (result.evidence && result.evidence.jaccard) || 0,
    obscureOverlap: (result.evidence && result.evidence.obscureOverlapCount) || 0,
    evidence: result.evidence,
    fired: result.fired,
  };
}

module.exports = {
  name: 'contract_interaction_overlap',
  description: 'Score overlap in obscure contract interactions between two wallets.',
  inputSchema,
  handler,
  validate,
};
