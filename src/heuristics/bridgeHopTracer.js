// src/heuristics/bridgeHopTracer.js
// Walks the bridge interaction log produced upstream and computes a hop
// density score. The real network following happens in the tool layer
// using the bridge registry; here we score the resulting graph.

const { clamp01 } = require('../scoring/confidenceEngine');
const NO_DATA = { score: 0, evidence: { reason: 'no_data' }, fired: false };

async function run(input = {}, _ctx = {}) {
  try {
    const edges = Array.isArray(input.edges) ? input.edges : [];
    if (edges.length === 0) {
      return { ...NO_DATA };
    }
    const totalAmount = edges.reduce(
      (acc, e) => acc + Number(e.amount || 0),
      0,
    );
    const distinctChains = new Set();
    const distinctBridges = new Set();
    for (const e of edges) {
      if (e.fromChain) distinctChains.add(e.fromChain);
      if (e.toChain) distinctChains.add(e.toChain);
      if (e.bridge) distinctBridges.add(e.bridge);
    }
    const breadth = clamp01(distinctChains.size / 4); // 4+ chains saturates
    const volume = clamp01(totalAmount / 100); // 100 ETH equivalent saturates
    const bridgeDiversity = clamp01(distinctBridges.size / 3);
    const score = clamp01(0.4 * breadth + 0.3 * volume + 0.3 * bridgeDiversity);
    return {
      score,
      evidence: {
        hops: edges.length,
        totalAmount,
        distinctChains: Array.from(distinctChains),
        distinctBridges: Array.from(distinctBridges),
      },
      fired: score > 0.05,
    };
  } catch (_) {
    return { ...NO_DATA };
  }
}

module.exports = { run };
