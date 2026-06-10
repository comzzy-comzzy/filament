// src/tools/sanctionProximityMapper.js
// Tool 10: sanction_proximity_mapper — exposure tree to sanctioned addresses.

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const sanction = require('../heuristics/sanctionProximity');

const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['wallet'],
  properties: {
    wallet: { type: 'string' },
    depth: { type: 'number', minimum: 1, maximum: 6, default: 3 },
  },
};

function validate(input) {
  if (!input || typeof input !== 'object') {
    throw new SchemaError('sanction_proximity_mapper', 'input must be an object');
  }
  return { wallet: validateAddress(input.wallet), depth: input.depth || 3 };
}

async function handler(input, ctx = {}) {
  const params = validate(input);
  const exposures = (ctx.sanctionExposures && ctx.sanctionExposures[params.wallet]) || [];
  const result = await sanction.run({ exposures }, ctx);
  return {
    wallet: params.wallet,
    depth: params.depth,
    tree: exposures,
    flagged: result.evidence ? result.evidence.flagged : [],
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
