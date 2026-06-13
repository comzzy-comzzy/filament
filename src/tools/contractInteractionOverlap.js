// src/tools/contractInteractionOverlap.js
// Tool 7: contract_interaction_overlap — obscure-contract overlap score.
//
// Resolution order:
//   1. ctx.interactions[wallet]  — override
//   2. live fetch via fetchContractInteractions per chain
//   3. NO_DATA (no provider, no override)

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const { listChains } = require('../config/chains');
const overlap = require('../heuristics/contractOverlap');
const fetchers = require('../rpc/fetchers');

const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['walletA', 'walletB'],
  properties: {
    walletA: { type: 'string' },
    walletB: { type: 'string' },
    chains: { type: 'array', items: { type: 'string' } },
  },
};

function validate(input) {
  if (!input || typeof input !== 'object') {
    throw new SchemaError('contract_interaction_overlap', 'input must be an object');
  }
  return {
    walletA: validateAddress(input.walletA),
    walletB: validateAddress(input.walletB),
    chains: input.chains || listChains(),
  };
}

async function fetchInteractionsFor(ctx, wallet, chains) {
  if (!ctx.getProvider) return [];
  const out = [];
  for (const chain of chains) {
    const provider = ctx.getProvider(chain);
    if (!provider) continue;
    try {
      const items = await fetchers.fetchContractInteractions(ctx, chain, wallet);
      out.push(...items);
    } catch (_) {
      // continue
    }
  }
  return out;
}

async function handler(input, ctx = {}) {
  const params = validate(input);
  let interactionsA = (ctx.interactions && ctx.interactions[params.walletA]) || [];
  let interactionsB = (ctx.interactions && ctx.interactions[params.walletB]) || [];

  if ((interactionsA.length === 0 || interactionsB.length === 0) && ctx.getProvider) {
    if (interactionsA.length === 0) {
      interactionsA = await fetchInteractionsFor(ctx, params.walletA, params.chains);
    }
    if (interactionsB.length === 0) {
      interactionsB = await fetchInteractionsFor(ctx, params.walletB, params.chains);
    }
  }

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
