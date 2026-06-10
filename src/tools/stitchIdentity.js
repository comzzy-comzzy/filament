// src/tools/stitchIdentity.js
// Tool 1: stitch_identity — primary identity stitching across chains.
//
// Orchestrates the eight wallet-shaped behavioral heuristics and projects
// the result through the confidence engine. The pairwise
// contract_interaction_overlap heuristic is intentionally NOT invoked here
// (it requires a second wallet); callers that need it should call the
// dedicated `contract_interaction_overlap` tool.
//
// Data flow:
//   1. Resolve providers per chain via ctx.getProvider; chains without a
//      configured provider are reported as `{ skipped: true, ... }`.
//   2. Gather per-chain data from ctx (explicit `chainData[wallet][chain]`
//      bag, or the flat convenience shapes used by the example scripts).
//   3. Fan out the eight wallet heuristics in parallel.
//   4. Aggregate via `confidenceEngine.aggregate()` for a single score and
//      tier (High / Probable / Speculative).
//   5. Return the full structured result.

'use strict';

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const { listChains } = require('../config/chains');
const { aggregate, DEFAULT_WEIGHTS } = require('../scoring/confidenceEngine');

const noncePattern = require('../heuristics/noncePattern');
const deploymentDna = require('../heuristics/deploymentDna');
const bridgeHopTracer = require('../heuristics/bridgeHopTracer');
const gasBehavior = require('../heuristics/gasBehavior');
const eoaClusterGraph = require('../heuristics/eoaClusterGraph');
const temporalCorrelation = require('../heuristics/temporalCorrelation');
const entropyScorer = require('../heuristics/entropyScorer');
const sanctionProximity = require('../heuristics/sanctionProximity');

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

// Pull a per-chain data bag for the given wallet, in order of precedence:
//   1. ctx.chainData[wallet][chain]  (explicit per-wallet bag)
//   2. the flat convenience shapes already used by the example scripts
function chainDataFor(ctx, wallet, chain) {
  const explicit = ctx.chainData && ctx.chainData[wallet] && ctx.chainData[wallet][chain];
  if (explicit && typeof explicit === 'object') return explicit;
  return {
    nonceSeries: ctx.nonceSeries && ctx.nonceSeries[chain],
    gasSamples: ctx.gasSamples && ctx.gasSamples[chain],
    fundingEdges: ctx.fundingEdges && ctx.fundingEdges[wallet],
    bridgeEdges: ctx.bridgeEdges && ctx.bridgeEdges[wallet],
    exposures: ctx.sanctionExposures && ctx.sanctionExposures[wallet],
    deployments: ctx.deployments && ctx.deployments[wallet],
    childAddresses: ctx.childAddresses && ctx.childAddresses[wallet],
    activityTimestamps: ctx.activityTimestamps && ctx.activityTimestamps[wallet],
  };
}

async function safeRun(mod, input, ctx) {
  try {
    return await mod.run(input, ctx);
  } catch (_) {
    return { score: 0, evidence: { reason: 'no_data' }, fired: false };
  }
}

async function handler(input, ctx = {}) {
  const params = validate(input);

  // Step 1: per-chain provider check.
  const perChain = {};
  const configuredChains = [];
  for (const chain of params.chains) {
    const provider = ctx.getProvider ? ctx.getProvider(chain) : null;
    if (!provider) {
      perChain[chain] = { skipped: true, reason: 'no_rpc_configured' };
      continue;
    }
    perChain[chain] = { ok: true, depth: params.depth };
    configuredChains.push(chain);
  }

  // Step 2: aggregate per-chain data across the configured chains.
  const seriesByChain = {};
  const samplesByChain = {};
  const fundingEdges = [];
  const bridgeEdges = [];
  const exposures = [];
  const deployments = [];
  const childAddresses = [];
  const activityTimestamps = {};
  let anyData = false;

  for (const chain of configuredChains) {
    const d = chainDataFor(ctx, params.wallet, chain);
    if (Array.isArray(d.nonceSeries) && d.nonceSeries.length > 0) {
      seriesByChain[chain] = d.nonceSeries;
      anyData = true;
    }
    if (Array.isArray(d.gasSamples) && d.gasSamples.length > 0) {
      samplesByChain[chain] = d.gasSamples;
      anyData = true;
    }
    if (Array.isArray(d.fundingEdges)) {
      for (const e of d.fundingEdges) fundingEdges.push(e);
      if (d.fundingEdges.length > 0) anyData = true;
    }
    if (Array.isArray(d.bridgeEdges)) {
      for (const e of d.bridgeEdges) bridgeEdges.push(e);
      if (d.bridgeEdges.length > 0) anyData = true;
    }
    if (Array.isArray(d.exposures)) {
      for (const e of d.exposures) exposures.push(e);
      if (d.exposures.length > 0) anyData = true;
    }
    if (Array.isArray(d.deployments)) {
      for (const e of d.deployments) deployments.push(e);
      if (d.deployments.length > 0) anyData = true;
    }
    if (Array.isArray(d.childAddresses)) {
      for (const a of d.childAddresses) childAddresses.push(a);
      if (d.childAddresses.length > 0) anyData = true;
    }
    if (Array.isArray(d.activityTimestamps) && d.activityTimestamps.length > 0) {
      activityTimestamps[params.wallet] = d.activityTimestamps;
      anyData = true;
    }
  }

  // Step 3: heuristic fan-out. The contract_interaction_overlap slot is
  // intentionally left to the dedicated tool — the stitch tool only has
  // one wallet, so a self-comparison would be meaningless.
  const heuristicScores = {};

  const [
    noncePatternOut,
    deploymentDnaOut,
    bridgeHopOut,
    gasBehaviorOut,
    eoaClusterOut,
    temporalOut,
    entropyOut,
    sanctionOut,
  ] = await Promise.all([
    safeRun(noncePattern, { seriesByChain }, ctx),
    safeRun(deploymentDna, { deployments }, ctx),
    safeRun(bridgeHopTracer, { edges: bridgeEdges }, ctx),
    safeRun(gasBehavior, { samplesByChain }, ctx),
    safeRun(eoaClusterGraph, { edges: fundingEdges }, ctx),
    safeRun(
      temporalCorrelation,
      {
        wallets: [{ wallet: params.wallet, timestamps: activityTimestamps[params.wallet] || [] }],
      },
      ctx,
    ),
    safeRun(entropyScorer, { addresses: childAddresses }, ctx),
    safeRun(sanctionProximity, { exposures }, ctx),
  ]);

  heuristicScores.noncePattern = noncePatternOut;
  heuristicScores.deploymentDna = deploymentDnaOut;
  heuristicScores.bridgeHop = bridgeHopOut;
  heuristicScores.gasBehavior = gasBehaviorOut;
  heuristicScores.eoaCluster = eoaClusterOut;
  heuristicScores.contractOverlap = {
    score: 0,
    evidence: {
      reason: 'pairwise_heuristic',
      tool: 'contract_interaction_overlap',
    },
    fired: false,
  };
  heuristicScores.temporalCorrelation = temporalOut;
  heuristicScores.entropyScorer = entropyOut;
  heuristicScores.sanctionProximity = sanctionOut;

  // Step 4: aggregate.
  const aggregated = aggregate(heuristicScores, { weights: DEFAULT_WEIGHTS });

  // Step 5: shape final return.
  const linkedWallets = (ctx.linkedWallets && ctx.linkedWallets[params.wallet]) || [];
  const graphPayload = ctx.graphPayload && ctx.graphPayload[params.wallet]
    ? ctx.graphPayload[params.wallet]
    : { nodes: [params.wallet, ...linkedWallets], edges: fundingEdges };

  return {
    wallet: params.wallet,
    chains: params.chains,
    depth: params.depth,
    perChain,
    heuristicScores,
    score: aggregated.score,
    tier: aggregated.tier,
    breakdown: aggregated.breakdown,
    linkedWallets,
    graphPayload,
    weights: DEFAULT_WEIGHTS,
    _meta: {
      anyData,
      configuredChains,
      skippedChains: params.chains.filter((c) => !configuredChains.includes(c)),
    },
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
