// src/tools/identityConfidenceReport.js
// Tool 11: identity_confidence_report — aggregate final report.

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const { aggregate, DEFAULT_WEIGHTS } = require('../scoring/confidenceEngine');

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
    throw new SchemaError('identity_confidence_report', 'input must be an object');
  }
  return { wallet: validateAddress(input.wallet) };
}

async function handler(input, ctx = {}) {
  const params = validate(input);
  const heuristicResults =
    (ctx.heuristicResults && ctx.heuristicResults[params.wallet]) || {};
  const report = aggregate(heuristicResults, { weights: DEFAULT_WEIGHTS });
  return {
    wallet: params.wallet,
    confidence: report.score,
    tier: report.tier,
    linkedWallets: (ctx.linkedWallets && ctx.linkedWallets[params.wallet]) || [],
    perHeuristic: report.breakdown,
    evidenceSummary: report.breakdown
      .filter((b) => b.fired)
      .map((b) => ({ heuristic: b.heuristic, contribution: b.contribution, evidence: b.evidence })),
    graphPayload:
      ctx.graphPayload && ctx.graphPayload[params.wallet]
        ? ctx.graphPayload[params.wallet]
        : { nodes: [params.wallet], edges: [] },
    weights: DEFAULT_WEIGHTS,
  };
}

module.exports = {
  name: 'identity_confidence_report',
  description: 'Aggregate all heuristic scores into a single structured report.',
  inputSchema,
  handler,
  validate,
};
