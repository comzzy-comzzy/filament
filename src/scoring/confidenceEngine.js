// src/scoring/confidenceEngine.js
// Aggregate per-heuristic scores into a single cluster confidence score
// using declared weights, and project the result onto a tier:
//
//   score >= 0.70            -> "High"
//   0.45 <= score < 0.70     -> "Probable"
//   score <  0.45            -> "Speculative"
//
// The weights must sum to 1.0; if a caller passes something different we
// renormalise silently rather than throw, because downstream tools rely on
// receiving a usable score.

const DEFAULT_WEIGHTS = Object.freeze({
  noncePattern: 0.10,
  deploymentDna: 0.15,
  bridgeHop: 0.10,
  gasBehavior: 0.10,
  eoaCluster: 0.15,
  contractOverlap: 0.15,
  temporalCorrelation: 0.10,
  entropyScorer: 0.05,
  sanctionProximity: 0.10,
});

const TIER_THRESHOLDS = Object.freeze({ high: 0.70, probable: 0.45 });

// `entry` is the per-heuristic result from a heuristic module. It MAY be
// missing or partially populated; we coerce defensively because the
// engine is the last line of defence before the result reaches a tool.
function normaliseEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return { score: 0, evidence: null, fired: false };
  }
  const rawScore = Number(entry.score);
  const score = Number.isFinite(rawScore) ? rawScore : 0;
  return {
    score,
    evidence: entry.evidence == null ? null : entry.evidence,
    fired: Boolean(entry.fired),
  };
}

function normalizeWeights(weights) {
  // When callers pass a custom weights object, only the keys they
  // specified count. Unspecified heuristics contribute 0. This is
  // deliberately stricter than `{...DEFAULT_WEIGHTS, ...weights}` —
  // the latter would silently fold defaults back in, which is
  // surprising and breaks tests like "sum to 1.0 with two keys".
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) {
    return { ...DEFAULT_WEIGHTS };
  }
  const keys = Object.keys(weights);
  if (keys.length === 0) {
    return { ...DEFAULT_WEIGHTS };
  }
  const merged = {};
  for (const k of keys) {
    const raw = Number(weights[k]);
    // Drop NaN / ±Infinity from the custom weights — they would
    // otherwise propagate into the renormalised sum and poison the
    // final score.
    if (!Number.isFinite(raw)) continue;
    if (raw < 0) continue; // negative weights are nonsensical
    merged[k] = raw;
  }
  const total = Object.values(merged).reduce((acc, w) => acc + w, 0);
  if (total === 0) {
    return { ...DEFAULT_WEIGHTS };
  }
  if (Math.abs(total - 1) < 1e-9) {
    return merged;
  }
  const out = {};
  for (const [k, v] of Object.entries(merged)) {
    out[k] = v / total;
  }
  return out;
}

function tierFor(score) {
  if (score >= TIER_THRESHOLDS.high) return 'High';
  if (score >= TIER_THRESHOLDS.probable) return 'Probable';
  return 'Speculative';
}

function aggregate(perHeuristic, { weights } = {}) {
  if (!perHeuristic || typeof perHeuristic !== 'object' || Array.isArray(perHeuristic)) {
    perHeuristic = {};
  }
  const w = normalizeWeights(weights);
  const breakdown = [];
  let weightedSum = 0;
  let weightTotal = 0;
  for (const [name, weight] of Object.entries(w)) {
    const entry = normaliseEntry(perHeuristic[name]);
    const score = clamp01(entry.score);
    const contribution = score * weight;
    weightedSum += contribution;
    weightTotal += weight;
    breakdown.push({
      heuristic: name,
      weight,
      score,
      fired: entry.fired,
      contribution,
      evidence: entry.evidence,
    });
  }
  const aggregateScore = weightTotal > 0 ? weightedSum / weightTotal : 0;
  const score = clamp01(aggregateScore);
  return {
    score,
    tier: tierFor(score),
    breakdown,
  };
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

module.exports = {
  DEFAULT_WEIGHTS,
  TIER_THRESHOLDS,
  normalizeWeights,
  tierFor,
  aggregate,
  clamp01,
  normaliseEntry,
};
