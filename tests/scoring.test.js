// tests/scoring.test.js
// Confidence engine tests: tier thresholds, weight renormalisation, and
// per-heuristic contribution math.

const {
  aggregate,
  tierFor,
  normalizeWeights,
  DEFAULT_WEIGHTS,
  TIER_THRESHOLDS,
} = require('../src/scoring/confidenceEngine');

describe('confidenceEngine.tierFor', () => {
  test('returns High above the high threshold', () => {
    expect(tierFor(TIER_THRESHOLDS.high + 0.01)).toBe('High');
  });

  test('returns Probable in the middle band', () => {
    const mid = (TIER_THRESHOLDS.high + TIER_THRESHOLDS.probable) / 2;
    expect(tierFor(mid)).toBe('Probable');
  });

  test('returns Speculative below the probable threshold', () => {
    expect(tierFor(TIER_THRESHOLDS.probable - 0.01)).toBe('Speculative');
  });
});

describe('confidenceEngine.normalizeWeights', () => {
  test('passes through weights that already sum to 1', () => {
    const w = normalizeWeights({ noncePattern: 0.5, gasBehavior: 0.5 });
    expect(w.noncePattern).toBeCloseTo(0.5);
    expect(w.gasBehavior).toBeCloseTo(0.5);
  });

  test('renormalises weights that do not sum to 1', () => {
    const w = normalizeWeights({ noncePattern: 2, gasBehavior: 2 });
    expect(w.noncePattern + w.gasBehavior).toBeCloseTo(1);
  });

  test('falls back to defaults if total weight is zero', () => {
    const w = normalizeWeights({ noncePattern: 0, gasBehavior: 0 });
    expect(w).toEqual(DEFAULT_WEIGHTS);
  });
});

describe('confidenceEngine.aggregate', () => {
  test('all zero scores give Speculative', () => {
    const out = aggregate({});
    expect(out.tier).toBe('Speculative');
    expect(out.score).toBe(0);
  });

  test('all-one scores give High', () => {
    const inputs = {};
    for (const k of Object.keys(DEFAULT_WEIGHTS)) {
      inputs[k] = { score: 1, evidence: { ok: true }, fired: true };
    }
    const out = aggregate(inputs);
    expect(out.tier).toBe('High');
    expect(out.score).toBeCloseTo(1);
  });

  test('mixed scores land in Probable band', () => {
    const inputs = {
      noncePattern: { score: 0.6, fired: true, evidence: {} },
      eoaCluster: { score: 0.7, fired: true, evidence: {} },
      contractOverlap: { score: 0.6, fired: true, evidence: {} },
    };
    // Use the same default weights via the engine; the weighted average of
    // these three scores (plus the other six at 0) lands around 0.34, so
    // we feed in custom weights that sum to 1 across just these three
    // heuristics to get a true Probable-band score.
    const out = aggregate(inputs, {
      weights: { noncePattern: 1 / 3, eoaCluster: 1 / 3, contractOverlap: 1 / 3 },
    });
    expect(out.tier).toBe('Probable');
    expect(out.score).toBeGreaterThan(0.45);
  });

  test('breakdown lists every heuristic with a weight', () => {
    const out = aggregate({});
    expect(out.breakdown).toHaveLength(Object.keys(DEFAULT_WEIGHTS).length);
    for (const row of out.breakdown) {
      expect(typeof row.weight).toBe('number');
      expect(row.weight).toBeGreaterThan(0);
    }
  });
});
