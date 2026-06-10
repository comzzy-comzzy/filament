// src/heuristics/sanctionProximity.js
// Scores the wallet's exposure to the bundled sanctions sample. Higher
// exposure (closer hop, more volume) is a stronger signal — but importantly
// "no exposure" is also a valid finding and must score 0 without firing.

const { clamp01 } = require('../scoring/confidenceEngine');
const { addresses: SANCTIONED } = require('../data/sanctions');
const NO_DATA = { score: 0, evidence: { reason: 'no_data' }, fired: false };

function buildSet(list) {
  return new Set((list || []).map((a) => String(a).toLowerCase()));
}

async function run(input = {}, _ctx = {}) {
  try {
    const exposures = Array.isArray(input.exposures) ? input.exposures : [];
    if (exposures.length === 0) {
      return { ...NO_DATA };
    }
    const sanctioned = buildSet(SANCTIONED.map((s) => s.address));
    let score = 0;
    const flagged = [];
    for (const ex of exposures) {
      const target = String(ex.target || '').toLowerCase();
      if (!sanctioned.has(target)) continue;
      const hop = Math.max(1, Number(ex.hop || 1));
      const volume = Number(ex.volume || 0);
      const hopScore = clamp01(1 / hop);
      const volumeScore = clamp01(volume / 10);
      const contrib = clamp01(0.6 * hopScore + 0.4 * volumeScore);
      if (contrib > score) score = contrib;
      flagged.push({ target, hop, volume, contribution: contrib });
    }
    return {
      score,
      evidence: {
        datasetVersion: require('../data/sanctions').dataset,
        exposures: exposures.length,
        flagged,
      },
      fired: score > 0,
    };
  } catch (_) {
    return { ...NO_DATA };
  }
}

module.exports = { run };
