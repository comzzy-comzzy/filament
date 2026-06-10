// src/heuristics/contractOverlap.js
// Given two wallets and their per-chain contract-interaction histories,
// scores the overlap on obscure contracts (the long tail — Uniswap-level
// apps are noise; tiny bespoke contracts are signal).

const { clamp01 } = require('../scoring/confidenceEngine');
const NO_DATA = { score: 0, evidence: { reason: 'no_data' }, fired: false };

function buildAddressSet(interactions) {
  const out = new Set();
  for (const item of interactions || []) {
    if (item && item.address) out.add(String(item.address).toLowerCase());
  }
  return out;
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

async function run(input = {}, _ctx = {}) {
  try {
    const a = input.walletA || {};
    const b = input.walletB || {};
    const setA = buildAddressSet(a.interactions);
    const setB = buildAddressSet(input.walletB ? b.interactions : []);
    if (setA.size === 0 || setB.size === 0) {
      return { ...NO_DATA };
    }
    const j = jaccard(setA, setB);
    // Boost weight if the overlapping contracts are tagged obscure.
    const obscureOverlap = (a.interactions || []).filter(
      (x) => x && x.obscure && setB.has(String(x.address).toLowerCase()),
    );
    const obscureBoost = clamp01(obscureOverlap.length / 5);
    const score = clamp01(0.7 * j + 0.3 * obscureBoost);
    return {
      score,
      evidence: {
        aInteractions: setA.size,
        bInteractions: setB.size,
        jaccard: j,
        obscureOverlapCount: obscureOverlap.length,
      },
      fired: score > 0,
    };
  } catch (_) {
    return { ...NO_DATA };
  }
}

module.exports = { run, jaccard, buildAddressSet };
