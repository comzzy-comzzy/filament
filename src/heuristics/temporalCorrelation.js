// src/heuristics/temporalCorrelation.js
// Cross-correlates activity timestamps for a list of wallets. Wallets
// active at identical unusual hours (e.g. 04:00 UTC) score high —
// schedulers and humans are not that random.

const { clamp01 } = require('../scoring/confidenceEngine');
const NO_DATA = { score: 0, evidence: { reason: 'no_data' }, fired: false };

function hourBuckets(timestamps) {
  const buckets = new Array(24).fill(0);
  for (const ts of timestamps || []) {
    const d = new Date(Number(ts) * 1000);
    if (Number.isNaN(d.getTime())) continue;
    buckets[d.getUTCHours()] += 1;
  }
  return buckets;
}

function cosineSimilarity(a, b) {
  const dot = a.reduce((acc, v, i) => acc + v * b[i], 0);
  const na = Math.hypot(...a) || 1;
  const nb = Math.hypot(...b) || 1;
  return clamp01(dot / (na * nb));
}

function matrixFor(wallets) {
  const buckets = wallets.map((w) => hourBuckets(w.timestamps));
  const matrix = [];
  for (let i = 0; i < wallets.length; i += 1) {
    const row = [];
    for (let j = 0; j < wallets.length; j += 1) {
      row.push(i === j ? 1 : cosineSimilarity(buckets[i], buckets[j]));
    }
    matrix.push(row);
  }
  return matrix;
}

function topPairs(matrix, wallets, k = 3) {
  const pairs = [];
  for (let i = 0; i < matrix.length; i += 1) {
    for (let j = i + 1; j < matrix.length; j += 1) {
      pairs.push({ a: wallets[i].wallet, b: wallets[j].wallet, score: matrix[i][j] });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  return pairs.slice(0, k);
}

async function run(input = {}, _ctx = {}) {
  try {
    const wallets = Array.isArray(input.wallets) ? input.wallets : [];
    if (wallets.length < 2) {
      return { ...NO_DATA };
    }
    const matrix = matrixFor(wallets);
    const top = topPairs(matrix, wallets);
    const avg =
      top.length > 0
        ? top.reduce((acc, p) => acc + p.score, 0) / top.length
        : 0;
    return {
      score: clamp01(avg),
      evidence: {
        matrix,
        topPairs: top,
        timezoneHint:
          top[0] && top[0].score > 0.6 ? 'concentrated_off_hours' : 'distributed',
      },
      fired: avg > 0.4,
    };
  } catch (_) {
    return { ...NO_DATA };
  }
}

module.exports = { run, hourBuckets, cosineSimilarity, matrixFor, topPairs };
