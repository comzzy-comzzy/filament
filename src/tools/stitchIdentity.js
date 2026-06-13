// src/tools/stitchIdentity.js
// Tool 1: stitch_identity — primary identity stitching across chains.
//
// Orchestrates the eight wallet-shaped behavioral heuristics and projects
// the result through the confidence engine. The pairwise
// contract_interaction_overlap heuristic is intentionally NOT invoked here
// (it requires a second wallet); callers that need it should call the
// dedicated `contract_interaction_overlap` tool.
//
// Data flow (live mode):
//   1. Resolve providers per chain via ctx.getProvider.
//   2. For each configured chain, call the onchain fetchers once to gather
//      nonce timestamps, funding edges, bridge edges, deployments, and
//      sanctions exposures. This avoids 8x the RPC calls compared to
//      letting each heuristic fetch its own bag.
//   3. Fan out the eight wallet heuristics in parallel.
//   4. Aggregate via `confidenceEngine.aggregate()`.
//   5. Return the full structured result.
//
// Data flow (test/example mode):
//   The same shape works with `ctx.nonceSeries`, `ctx.fundingEdges`, etc.
//   pre-populated by the caller — when those are present we honour them
//   verbatim and skip the live fetcher.

'use strict';

const { validateAddress } = require('../utils/checksum');
const { SchemaError } = require('../utils/errors');
const { listChains } = require('../config/chains');
const { aggregate, DEFAULT_WEIGHTS } = require('../scoring/confidenceEngine');
const fetchers = require('../rpc/fetchers');
const { addresses: SANCTIONED } = require('../data/sanctions');

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

function lower(s) {
  return String(s || '').toLowerCase();
}

// Returns true if the bag has anything we'd consider "data" — used to
// decide whether to skip the live fetcher.
function hasOverrideData(bag) {
  return Boolean(
    (bag.nonceSeries && Object.keys(bag.nonceSeries).length > 0) ||
      (bag.fundingEdges && bag.fundingEdges.length > 0) ||
      (bag.bridgeEdges && bag.bridgeEdges.length > 0) ||
      (bag.deployments && bag.deployments.length > 0) ||
      (bag.gasSamples && Object.keys(bag.gasSamples).length > 0) ||
      (bag.sanctionExposures && bag.sanctionExposures.length > 0) ||
      (bag.childAddresses && bag.childAddresses.length > 0) ||
      (bag.activityTimestamps && bag.activityTimestamps.length > 0),
  );
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

  // Step 2: gather per-chain data. Honor test/example overrides first;
  // fall through to live fetchers when the override is missing.
  const seriesByChain = {};
  const samplesByChain = {};
  const fundingEdges = [];
  const bridgeEdges = [];
  const exposures = [];
  const deployments = [];
  const childAddresses = [];
  const activityTimestamps = {};
  let anyData = false;

  // Honour explicit ctx-level overrides first (test/example contract).
  for (const chain of configuredChains) {
    const d = {
      nonceSeries: ctx.nonceSeries && ctx.nonceSeries[chain],
      gasSamples: ctx.gasSamples && ctx.gasSamples[chain],
      fundingEdges: ctx.fundingEdges && ctx.fundingEdges[params.wallet],
      bridgeEdges: ctx.bridgeEdges && ctx.bridgeEdges[params.wallet],
      exposures: ctx.sanctionExposures && ctx.sanctionExposures[params.wallet],
      deployments: ctx.deployments && ctx.deployments[params.wallet],
      childAddresses: ctx.childAddresses && ctx.childAddresses[params.wallet],
      activityTimestamps: ctx.activityTimestamps && ctx.activityTimestamps[params.wallet],
    };
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

  // If no override data was provided AND we have at least one live
  // provider, fetch from chain. This is the hot path for production.
  const hasOverride = hasOverrideData({
    nonceSeries: Object.keys(seriesByChain).length > 0 ? seriesByChain : null,
    fundingEdges,
    bridgeEdges,
    deployments,
    gasSamples: Object.keys(samplesByChain).length > 0 ? samplesByChain : null,
    sanctionExposures: exposures,
    childAddresses,
    activityTimestamps: activityTimestamps[params.wallet] || null,
  });

  if (!hasOverride && configuredChains.length > 0) {
    const allBlockNumbers = new Set();
    const blockChain = new Map(); // blockNumber -> chain
    const perChainActivity = new Map();

    for (const chain of configuredChains) {
      try {
        const activity = await fetchers.fetchEOAActivity(ctx, chain, params.wallet);
        perChainActivity.set(chain, activity);
        if (activity.fundingEdges.length > 0) anyData = true;
        for (const e of activity.fundingEdges) {
          if (e.blockNumber != null) {
            allBlockNumbers.add(e.blockNumber);
            blockChain.set(e.blockNumber, chain);
          }
          fundingEdges.push(e);
        }
      } catch (_) {
        // continue
      }
    }

    // Block timestamps → nonce series per chain + activityTimestamps.
    for (const chain of configuredChains) {
      const activity = perChainActivity.get(chain);
      if (!activity) continue;
      const blockNumbers = Array.from(
        new Set(activity.fundingEdges.map((e) => e.blockNumber).filter((b) => b != null)),
      );
      const tsMap = await fetchers.fetchTimestamps(ctx, chain, blockNumbers);
      const ts = [];
      for (const e of activity.fundingEdges) {
        const t = tsMap[e.blockNumber];
        if (t != null) ts.push(t);
      }
      ts.sort((a, b) => a - b);
      if (ts.length > 0) {
        seriesByChain[chain] = ts;
        activityTimestamps[params.wallet] = (activityTimestamps[params.wallet] || []).concat(ts);
      }
    }

    // Gas samples per chain.
    for (const chain of configuredChains) {
      const activity = perChainActivity.get(chain);
      if (!activity) continue;
      const txHashes = Array.from(activity.txHashes);
      if (txHashes.length === 0) continue;
      try {
        const samples = await fetchers.fetchGasSamples(ctx, chain, txHashes);
        if (samples.length > 0) {
          samplesByChain[chain] = samples;
          anyData = true;
        }
      } catch (_) {
        // continue
      }
    }

    // Bridge interactions per chain.
    for (const chain of configuredChains) {
      try {
        const hits = await fetchers.fetchBridgeInteractions(ctx, chain, params.wallet);
        for (const h of hits) bridgeEdges.push(h);
        if (hits.length > 0) anyData = true;
      } catch (_) {
        // continue
      }
    }

    // Deployments per chain.
    for (const chain of configuredChains) {
      try {
        const ds = await fetchers.fetchDeployments(ctx, chain, params.wallet);
        for (const d of ds) deployments.push(d);
        if (ds.length > 0) anyData = true;
      } catch (_) {
        // continue
      }
    }

    // Sanctions exposures: walk the funding edges and check each
    // counterparty against the bundled sanctions list.
    const sanctioned = new Set(SANCTIONED.map((s) => lower(s.address)));
    const flaggedPeers = new Map(); // peer -> { target, hop, volume, chain }
    for (const e of fundingEdges) {
      for (const peer of [e.from, e.to]) {
        if (!peer || peer === lower(params.wallet)) continue;
        if (sanctioned.has(peer) && !flaggedPeers.has(peer)) {
          flaggedPeers.set(peer, { target: peer, hop: 1, volume: 1, chain: e.chain });
        }
      }
    }
    for (const v of flaggedPeers.values()) exposures.push(v);
    if (exposures.length > 0) anyData = true;

    // Child addresses: from funding edges (counterparties) + bridge
    // counterparties + token contracts.
    const childSet = new Set();
    for (const e of fundingEdges) {
      if (e.from && e.from !== lower(params.wallet)) childSet.add(e.from);
      if (e.to && e.to !== lower(params.wallet)) childSet.add(e.to);
    }
    for (const c of childSet) childAddresses.push(c);
    if (childAddresses.length > 0) anyData = true;
  }

  // Step 3: heuristic fan-out.
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
        wallets: [
          {
            wallet: params.wallet,
            timestamps: activityTimestamps[params.wallet] || [],
          },
        ],
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
  const graphPayload =
    ctx.graphPayload && ctx.graphPayload[params.wallet]
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
      dataSource: hasOverride ? 'ctx_override' : 'live_fetch',
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
