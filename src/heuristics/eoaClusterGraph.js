// src/heuristics/eoaClusterGraph.js
// Scores how "central" a wallet is inside its funded/funder cluster. A
// wallet with many direct counterparties AND high reciprocity is more
// likely to be the operator's hub than an isolated sink.

const { clamp01 } = require('../scoring/confidenceEngine');
const NO_DATA = { score: 0, evidence: { reason: 'no_data' }, fired: false };

async function run(input = {}, _ctx = {}) {
  try {
    const edges = Array.isArray(input.edges) ? input.edges : [];
    if (edges.length === 0) {
      return { ...NO_DATA };
    }
    const counter = new Map();
    const reciprocity = new Map();
    for (const e of edges) {
      if (!e || !e.from || !e.to) continue;
      counter.set(e.from, (counter.get(e.from) || new Set()).add(e.to));
      const setTo = counter.get(e.from);
      setTo.add(e.to);
      counter.set(e.to, (counter.get(e.to) || new Set()).add(e.from));
    }
    let bestScore = 0;
    let bestAddress = null;
    for (const [addr, set] of counter) {
      let mutual = 0;
      for (const peer of set) {
        const peerSet = counter.get(peer);
        if (peerSet && peerSet.has(addr)) mutual += 1;
      }
      const score = clamp01(set.size > 0 ? mutual / set.size : 0);
      if (score > bestScore) {
        bestScore = score;
        bestAddress = addr;
      }
      reciprocity.set(addr, { degree: set.size, mutual });
    }
    return {
      score: bestScore,
      evidence: {
        edges: edges.length,
        candidate: bestAddress,
        reciprocity: Array.from(reciprocity.entries()).map(([address, v]) => ({
          address,
          ...v,
        })),
      },
      fired: bestScore > 0.1,
    };
  } catch (_) {
    return { ...NO_DATA };
  }
}

module.exports = { run };
