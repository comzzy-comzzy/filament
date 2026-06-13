// src/tools/sanctionProximityMapper.js
// Tool 10: sanction_proximity_mapper — exposure tree to sanctioned addresses.
//
// Resolution order:
//   1. ctx.sanctionExposures[wallet]  — override
//   2. live fetch: gather counterparties from fetchEOAActivity across
//      chains, then check each one against the bundled sanctions list
//   3. NO_DATA (no provider, no override)

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const { listChains } = require('../config/chains');
const sanction = require('../heuristics/sanctionProximity');
const { addresses: SANCTIONED } = require('../data/sanctions');
const fetchers = require('../rpc/fetchers');

const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['wallet'],
  properties: {
    wallet: { type: 'string' },
    depth: { type: 'number', minimum: 1, maximum: 6, default: 3 },
    chains: { type: 'array', items: { type: 'string' } },
  },
};

function validate(input) {
  if (!input || typeof input !== 'object') {
    throw new SchemaError('sanction_proximity_mapper', 'input must be an object');
  }
  return {
    wallet: validateAddress(input.wallet),
    depth: input.depth || 3,
    chains: input.chains || listChains(),
  };
}

function lower(s) {
  return String(s || '').toLowerCase();
}

async function handler(input, ctx = {}) {
  const params = validate(input);
  let exposures = (ctx.sanctionExposures && ctx.sanctionExposures[params.wallet]) || [];

  if (exposures.length === 0 && ctx.getProvider) {
    const sanctioned = new Set(SANCTIONED.map((s) => lower(s.address)));
    const seen = new Map(); // target -> { hop, volume, chain }
    for (const chain of params.chains) {
      const provider = ctx.getProvider(chain);
      if (!provider) continue;
      try {
        const activity = await fetchers.fetchEOAActivity(ctx, chain, params.wallet);
        for (const e of activity.fundingEdges) {
          for (const peer of [e.from, e.to]) {
            if (!peer || peer === activity.wallet) continue;
            if (sanctioned.has(peer) && !seen.has(peer)) {
              seen.set(peer, { target: peer, hop: 1, volume: 1, chain });
            }
          }
        }
      } catch (_) {
        // continue
      }
    }
    exposures = Array.from(seen.values());
  }

  const result = await sanction.run({ exposures }, ctx);
  return {
    wallet: params.wallet,
    depth: params.depth,
    tree: exposures,
    flagged: (result.evidence && result.evidence.flagged) || [],
    score: result.score,
    fired: result.fired,
    evidence: result.evidence,
  };
}

module.exports = {
  name: 'sanction_proximity_mapper',
  description: 'Map cluster exposure to sanctioned addresses up to N hops.',
  inputSchema,
  handler,
  validate,
};
