// tests/scoring.test.js
// Confidence engine tests: tier thresholds, weight renormalisation, and
// per-heuristic contribution math.

const {
  aggregate,
  tierFor,
  normalizeWeights,
  normaliseEntry,
  clamp01,
  DEFAULT_WEIGHTS,
  TIER_THRESHOLDS,
} = require('../src/scoring/confidenceEngine');

// Per-spec default weights. These MUST match the values documented in
// docs/architecture.md and the plan, so a regression in either direction
// is caught here.
const EXPECTED_WEIGHTS = Object.freeze({
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

describe('confidenceEngine.tierFor', () => {
  test('returns High above the high threshold', () => {
    expect(tierFor(TIER_THRESHOLDS.high + 0.01)).toBe('High');
  });

  test('returns High at exactly the high threshold (inclusive lower bound)', () => {
    expect(tierFor(TIER_THRESHOLDS.high)).toBe('High');
  });

  test('returns Probable in the middle band', () => {
    const mid = (TIER_THRESHOLDS.high + TIER_THRESHOLDS.probable) / 2;
    expect(tierFor(mid)).toBe('Probable');
  });

  test('returns Probable at exactly the probable threshold (inclusive lower bound)', () => {
    expect(tierFor(TIER_THRESHOLDS.probable)).toBe('Probable');
  });

  test('returns Speculative just below the probable threshold', () => {
    expect(tierFor(TIER_THRESHOLDS.probable - 0.01)).toBe('Speculative');
  });

  test('returns Speculative for 0 and negative scores', () => {
    expect(tierFor(0)).toBe('Speculative');
    expect(tierFor(-0.1)).toBe('Speculative');
  });

  test('tier is one of the three declared labels', () => {
    for (const s of [0, 0.1, 0.4, 0.5, 0.6, 0.8, 1.0]) {
      expect(['High', 'Probable', 'Speculative']).toContain(tierFor(s));
    }
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

  test('falls back to defaults on non-object input', () => {
    expect(normalizeWeights(null)).toEqual(DEFAULT_WEIGHTS);
    expect(normalizeWeights(undefined)).toEqual(DEFAULT_WEIGHTS);
    expect(normalizeWeights([])).toEqual(DEFAULT_WEIGHTS);
    expect(normalizeWeights('bad')).toEqual(DEFAULT_WEIGHTS);
  });

  test('drops NaN and Infinity weight values', () => {
    const w = normalizeWeights({ a: 1, b: Number.NaN, c: Number.POSITIVE_INFINITY });
    expect(Object.keys(w).sort()).toEqual(['a'].sort());
  });

  test('drops negative weight values', () => {
    const w = normalizeWeights({ a: 2, b: -1 });
    expect(Object.keys(w).sort()).toEqual(['a'].sort());
    expect(w.a).toBeCloseTo(1);
  });

  test('coerces numeric strings to numbers', () => {
    const w = normalizeWeights({ a: '0.5', b: '0.5' });
    expect(w.a + w.b).toBeCloseTo(1);
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

  test('breakdown row carries heuristic name, weight, score, fired, contribution, evidence', () => {
    const out = aggregate({
      noncePattern: { score: 0.8, fired: true, evidence: { reason: 'matched' } },
    });
    const row = out.breakdown.find((r) => r.heuristic === 'noncePattern');
    expect(row).toBeDefined();
    expect(row.weight).toBeCloseTo(0.1);
    expect(row.score).toBeCloseTo(0.8);
    expect(row.fired).toBe(true);
    expect(row.evidence).toEqual({ reason: 'matched' });
    expect(row.contribution).toBeCloseTo(0.08);
  });

  test('missing heuristic entries default to {score:0, evidence:null, fired:false}', () => {
    const out = aggregate({});
    for (const row of out.breakdown) {
      expect(row.score).toBe(0);
      expect(row.fired).toBe(false);
      expect(row.evidence).toBeNull();
    }
  });

  test('contributions across the breakdown sum to the final score', () => {
    const inputs = {
      noncePattern: { score: 0.9, fired: true, evidence: {} },
      deploymentDna: { score: 0.5, fired: true, evidence: {} },
      eoaCluster: { score: 0.7, fired: true, evidence: {} },
    };
    const out = aggregate(inputs);
    const sumContrib = out.breakdown.reduce((acc, r) => acc + r.contribution, 0);
    expect(sumContrib).toBeCloseTo(out.score, 6);
  });

  test('out-of-range per-heuristic scores are clamped to [0, 1]', () => {
    const out = aggregate({
      noncePattern: { score: 1.7, fired: true, evidence: {} },
      deploymentDna: { score: -0.4, fired: true, evidence: {} },
    });
    const np = out.breakdown.find((r) => r.heuristic === 'noncePattern');
    const ddna = out.breakdown.find((r) => r.heuristic === 'deploymentDna');
    expect(np.score).toBe(1);
    expect(ddna.score).toBe(0);
  });

  test('NaN and non-numeric scores coerce to 0', () => {
    const out = aggregate({
      noncePattern: { score: Number.NaN, fired: true, evidence: {} },
      deploymentDna: { score: 'oops', fired: true, evidence: {} },
    });
    const np = out.breakdown.find((r) => r.heuristic === 'noncePattern');
    const ddna = out.breakdown.find((r) => r.heuristic === 'deploymentDna');
    expect(np.score).toBe(0);
    expect(ddna.score).toBe(0);
  });

  test('non-object perHeuristic is treated as empty', () => {
    const out = aggregate(null);
    expect(out.score).toBe(0);
    expect(out.tier).toBe('Speculative');
    expect(out.breakdown).toHaveLength(Object.keys(DEFAULT_WEIGHTS).length);
    for (const row of out.breakdown) {
      expect(row.score).toBe(0);
    }
  });

  test('array perHeuristic is treated as empty (defensive)', () => {
    const out = aggregate([]);
    expect(out.score).toBe(0);
    expect(out.tier).toBe('Speculative');
  });

  test('malformed heuristic entries do not crash and are coerced', () => {
    const out = aggregate({
      noncePattern: null,
      deploymentDna: 42,
      bridgeHop: 'oops',
      eoaCluster: { score: 0.5, fired: true, evidence: { ok: true } },
    });
    expect(out.score).toBeGreaterThan(0);
    // Sanity: eoaCluster contributes 0.075 of the score (0.5 * 0.15).
    const ec = out.breakdown.find((r) => r.heuristic === 'eoaCluster');
    expect(ec.contribution).toBeCloseTo(0.075);
  });

  test('output is JSON-serialisable', () => {
    const inputs = {
      noncePattern: { score: 0.5, fired: true, evidence: { chain: 'ethereum' } },
    };
    const out = aggregate(inputs);
    expect(() => JSON.stringify(out)).not.toThrow();
    const round = JSON.parse(JSON.stringify(out));
    expect(round.score).toBe(out.score);
    expect(round.tier).toBe(out.tier);
    expect(round.breakdown).toEqual(out.breakdown);
  });

  test('custom weights override the default weight for that heuristic only', () => {
    // Bump noncePattern from 0.10 to 0.50; all other heuristics fall back
    // to defaults.
    const out = aggregate(
      { noncePattern: { score: 1, fired: true, evidence: {} } },
      { weights: { noncePattern: 0.5 } }
    );
    // With just one heuristic firing at 1.0 with weight 0.5, the score is
    // 0.5 / 0.5 = 1.0 (after renormalisation the effective weight is 1.0).
    expect(out.score).toBeCloseTo(1);
    expect(out.tier).toBe('High');
  });

  test('custom weights with two keys summing to 1 average those two', () => {
    const out = aggregate(
      {
        noncePattern: { score: 0.8, fired: true, evidence: {} },
        gasBehavior: { score: 0.4, fired: true, evidence: {} },
      },
      { weights: { noncePattern: 0.5, gasBehavior: 0.5 } }
    );
    expect(out.score).toBeCloseTo(0.6);
    expect(out.tier).toBe('Probable');
  });
});

describe('confidenceEngine.default weights', () => {
  test('matches the spec exactly (per-heuristic weight values)', () => {
    expect(DEFAULT_WEIGHTS).toEqual(EXPECTED_WEIGHTS);
  });

  test('sums to exactly 1.0', () => {
    const total = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });

  test('contains all 9 documented heuristics', () => {
    expect(Object.keys(DEFAULT_WEIGHTS).sort()).toEqual(
      Object.keys(EXPECTED_WEIGHTS).sort()
    );
  });

  test('is frozen so callers cannot mutate it', () => {
    expect(Object.isFrozen(DEFAULT_WEIGHTS)).toBe(true);
  });
});

describe('confidenceEngine.clamp01', () => {
  test('clamps below zero to 0', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(-100)).toBe(0);
  });

  test('clamps above one to 1', () => {
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(100)).toBe(1);
  });

  test('passes through values inside [0, 1]', () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(1)).toBe(1);
  });

  test('coerces non-finite values to 0', () => {
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(0);
    expect(clamp01(-Infinity)).toBe(0);
  });
});

describe('confidenceEngine.normaliseEntry', () => {
  test('coerces null/undefined to a zero entry', () => {
    expect(normaliseEntry(null)).toEqual({ score: 0, evidence: null, fired: false });
    expect(normaliseEntry(undefined)).toEqual({ score: 0, evidence: null, fired: false });
  });

  test('coerces non-object values to a zero entry', () => {
    expect(normaliseEntry(42)).toEqual({ score: 0, evidence: null, fired: false });
    expect(normaliseEntry('x')).toEqual({ score: 0, evidence: null, fired: false });
    expect(normaliseEntry(true)).toEqual({ score: 0, evidence: null, fired: false });
  });

  test('coerces NaN / non-numeric score to 0', () => {
    expect(normaliseEntry({ score: NaN, fired: true, evidence: { x: 1 } }).score).toBe(0);
    expect(normaliseEntry({ score: 'oops' }).score).toBe(0);
  });

  test('preserves fired boolean and evidence object', () => {
    const e = normaliseEntry({ score: 0.5, fired: true, evidence: { why: 'reason' } });
    expect(e.fired).toBe(true);
    expect(e.evidence).toEqual({ why: 'reason' });
  });

  test('normalises missing evidence to null (not undefined)', () => {
    expect(normaliseEntry({ score: 0.5, fired: false }).evidence).toBeNull();
  });
});
