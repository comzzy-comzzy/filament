// src/heuristics/noncePattern.js
// Compares per-chain transaction nonce sequences to detect shared operator
// rhythm. Two wallets that consistently submit transactions with the same
// delta pattern (sleep cycles, weekend gaps) probably share a scheduler.

const { clamp01 } = require('../scoring/confidenceEngine');
const NO_DATA = { score: 0, evidence: { reason: 'no_data' }, fired: false };

function gapStats(timestamps) {
  if (!Array.isArray(timestamps) || timestamps.length < 2) {
    return null;
  }
  const sorted = timestamps.slice().sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < sorted.length; i += 1) {
    gaps.push(sorted[i] - sorted[i - 1]);
  }
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const variance =
    gaps.reduce((acc, g) => acc + (g - mean) ** 2, 0) / gaps.length;
  return { mean, std: Math.sqrt(variance), count: gaps.length };
}

function shapeSimilarity(a, b) {
  if (!a || !b) return 0;
  const ratio = Math.min(a.mean, b.mean) / Math.max(a.mean, b.mean || 1);
  // Penalise mismatched dispersion as well — identical mean with very
  // different variance means different burst patterns.
  const stdRatio =
    Math.min(a.std, b.std) / Math.max(a.std, b.std || 1, 1);
  return clamp01(0.6 * ratio + 0.4 * stdRatio);
}

async function run(input = {}, _ctx = {}) {
  try {
    const seriesByChain = input.seriesByChain || {};
    const chains = Object.keys(seriesByChain);
    if (chains.length < 2) {
      return { ...NO_DATA };
    }
    const stats = chains.map((c) => ({
      chain: c,
      stats: gapStats(seriesByChain[c]),
    }));
    const usable = stats.filter((s) => s.stats);
    if (usable.length < 2) {
      return { ...NO_DATA };
    }
    let best = 0;
    for (let i = 0; i < usable.length; i += 1) {
      for (let j = i + 1; j < usable.length; j += 1) {
        best = Math.max(best, shapeSimilarity(usable[i].stats, usable[j].stats));
      }
    }
    return {
      score: best,
      evidence: {
        chains: usable.map((s) => s.chain),
        meanGapSeconds: usable.map((s) => ({ chain: s.chain, mean: s.stats.mean })),
        similarity: best,
      },
      fired: best > 0.2,
    };
  } catch (_) {
    return { ...NO_DATA };
  }
}

module.exports = { run, gapStats, shapeSimilarity };
