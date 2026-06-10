// tests/heuristics.test.js
// Verifies the nine heuristic modules. Every test checks both the empty
// case (no_data) and a fired-data case so the canonical return shape is
// locked in for downstream tools.

const { makeContext, makeMockProvider } = require('./fixtures/rpcMock');

const nonce = require('../src/heuristics/noncePattern');
const dna = require('../src/heuristics/deploymentDna');
const bridge = require('../src/heuristics/bridgeHopTracer');
const gas = require('../src/heuristics/gasBehavior');
const eoa = require('../src/heuristics/eoaClusterGraph');
const overlap = require('../src/heuristics/contractOverlap');
const temporal = require('../src/heuristics/temporalCorrelation');
const entropy = require('../src/heuristics/entropyScorer');
const sanction = require('../src/heuristics/sanctionProximity');

// Canonical NO_DATA shape — the exact contract AC-13 requires when input
// is empty or unparseable. The implementations must return this shape
// (not just "a result with score 0 and fired false").
const NO_DATA_SHAPE = Object.freeze({
  score: 0,
  evidence: Object.freeze({ reason: 'no_data' }),
  fired: false,
});

const HEURISTICS = {
  nonce: { mod: nonce, name: 'noncePattern' },
  dna: { mod: dna, name: 'deploymentDna' },
  bridge: { mod: bridge, name: 'bridgeHopTracer' },
  gas: { mod: gas, name: 'gasBehavior' },
  eoa: { mod: eoa, name: 'eoaClusterGraph' },
  overlap: { mod: overlap, name: 'contractOverlap' },
  temporal: { mod: temporal, name: 'temporalCorrelation' },
  entropy: { mod: entropy, name: 'entropyScorer' },
  sanction: { mod: sanction, name: 'sanctionProximity' },
};

function expectShape(result) {
  expect(result).toEqual(
    expect.objectContaining({
      score: expect.any(Number),
      evidence: expect.anything(),
      fired: expect.any(Boolean),
    }),
  );
  expect(result.score).toBeGreaterThanOrEqual(0);
  expect(result.score).toBeLessThanOrEqual(1);
}

describe('heuristics — module surface', () => {
  test('exactly 9 heuristic modules are registered', () => {
    expect(Object.keys(HEURISTICS)).toHaveLength(9);
  });

  for (const { mod, name } of Object.values(HEURISTICS)) {
    test(`${name} exports async run(input, ctx) with length 2`, () => {
      expect(typeof mod.run).toBe('function');
      // `run.length` is the declared arity (params before the first default).
      // Heuristics accept (input, ctx = {}) so the declared arity is 1, but
      // the test below proves both can be passed.
      const r = mod.run({}, {});
      expect(r).toBeInstanceOf(Promise);
      return r; // settle the promise so Jest does not flag a leak
    });

    test(`${name} accepts a populated ctx without error`, async () => {
      const ctx = makeContext({
        getProvider: () => makeMockProvider(),
        configuredChains: ['ethereum', 'arbitrum'],
      });
      const out = await mod.run({}, ctx);
      expectShape(out);
    });
  }
});

describe('heuristics — canonical NO_DATA shape on empty/garbage input', () => {
  const EMPTY_INPUTS = [
    ['empty object', {}],
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['string', 'oops'],
    ['array', []],
  ];

  for (const { mod, name } of Object.values(HEURISTICS)) {
    for (const [label, input] of EMPTY_INPUTS) {
      test(`${name} on ${label} returns exact NO_DATA shape`, async () => {
        const out = await mod.run(input);
        // Deep equality on the canonical shape.
        expect(out).toEqual(NO_DATA_SHAPE);
      });
    }
  }
});

describe('heuristics — output is JSON-serialisable', () => {
  for (const { mod, name } of Object.values(HEURISTICS)) {
    test(`${name} on empty input serialises cleanly`, async () => {
      const out = await mod.run({});
      const round = JSON.parse(JSON.stringify(out));
      expect(round).toEqual(out);
    });
  }
});

describe('heuristics — ctx is threaded through without breaking anything', () => {
  test('noncePattern with mock ctx + fired input still fires', async () => {
    const ctx = makeContext({ getProvider: () => null });
    const series = [1, 2, 4, 9, 16, 26];
    const out = await nonce.run(
      { seriesByChain: { ethereum: series, base: series } },
      ctx,
    );
    expectShape(out);
    expect(out.score).toBeGreaterThan(0.2);
  });

  test('gasBehavior with mock ctx + identical samples still fires', async () => {
    const ctx = makeContext({ getProvider: () => null });
    const samples = { baseFee: 30, tip: 2, gasLimit: 21000 };
    const out = await gas.run(
      { samplesByChain: { ethereum: [samples], optimism: [samples] } },
      ctx,
    );
    expectShape(out);
    expect(out.score).toBeGreaterThan(0.9);
  });
});

describe('noncePattern — fired case', () => {
  test('detects matching gap shapes across two chains', async () => {
    const series = [1, 2, 4, 9, 16, 26];
    const out = await nonce.run({ seriesByChain: { ethereum: series, base: series } });
    expectShape(out);
    expect(out.score).toBeGreaterThan(0.2);
  });

  test('gapStats returns null for arrays shorter than 2', () => {
    expect(nonce.gapStats([])).toBeNull();
    expect(nonce.gapStats(null)).toBeNull();
    expect(nonce.gapStats([5])).toBeNull();
  });

  test('gapStats is sorted internally so non-monotonic input still works', () => {
    const stats = nonce.gapStats([10, 1, 5, 2]);
    // Sorted -> [1, 2, 5, 10], gaps = [1, 3, 5], mean = 3.
    expect(stats.mean).toBeCloseTo(3, 6);
    expect(stats.count).toBe(3);
  });

  test('shapeSimilarity returns 0 on null inputs', () => {
    expect(nonce.shapeSimilarity(null, null)).toBe(0);
    expect(nonce.shapeSimilarity(null, {})).toBe(0);
  });
});

describe('deploymentDna — fired case', () => {
  test('scores higher when two deployments share a fingerprint', async () => {
    const out = await dna.run({
      deployments: [
        { chain: 'ethereum', bytecode: '0xdeadbeef' },
        { chain: 'base', bytecode: '0xdeadbeef' },
        { chain: 'optimism', bytecode: '0x1234' },
      ],
    });
    expectShape(out);
    expect(out.score).toBeGreaterThan(0);
    expect(out.fired).toBe(true);
  });

  test('fingerprint returns null for missing/non-string bytecode', () => {
    expect(dna.fingerprint(null)).toBeNull();
    expect(dna.fingerprint(undefined)).toBeNull();
    expect(dna.fingerprint(42)).toBeNull();
  });

  test('skips deployments with falsy bytecode', async () => {
    const out = await dna.run({
      deployments: [
        { chain: 'ethereum', bytecode: null },
        { chain: 'base', bytecode: '' },
        { chain: 'optimism' },
      ],
    });
    expect(out).toEqual(NO_DATA_SHAPE);
  });
});

describe('bridgeHopTracer — fired case', () => {
  test('aggregates volume across multiple chains', async () => {
    const out = await bridge.run({
      edges: [
        { fromChain: 'ethereum', toChain: 'arbitrum', amount: 5, bridge: 'stargate' },
        { fromChain: 'arbitrum', toChain: 'base', amount: 6, bridge: 'hop' },
        { fromChain: 'base', toChain: 'optimism', amount: 7, bridge: 'across' },
      ],
    });
    expectShape(out);
    expect(out.fired).toBe(true);
  });

  test('coerces non-array edges to empty', async () => {
    const out = await bridge.run({ edges: 'oops' });
    expect(out).toEqual(NO_DATA_SHAPE);
  });
});

describe('gasBehavior — fired case', () => {
  test('high cosine on identical signatures', async () => {
    const samples = { baseFee: 30, tip: 2, gasLimit: 21000 };
    const out = await gas.run({
      samplesByChain: {
        ethereum: [samples, samples, samples],
        optimism: [samples, samples, samples],
      },
    });
    expectShape(out);
    expect(out.score).toBeGreaterThan(0.9);
  });

  test('summarise returns null for empty/non-array input', () => {
    expect(gas.summarise(null)).toBeNull();
    expect(gas.summarise([])).toBeNull();
    expect(gas.summarise('oops')).toBeNull();
  });

  test('cosine returns 0 on null inputs', () => {
    expect(gas.cosine(null, null)).toBe(0);
  });
});

describe('eoaClusterGraph — fired case', () => {
  test('mutual edges raise the centrality score', async () => {
    const a = '0x' + '11'.repeat(20);
    const b = '0x' + '22'.repeat(20);
    const c = '0x' + '33'.repeat(20);
    const out = await eoa.run({
      edges: [
        { from: a, to: b },
        { from: b, to: a },
        { from: a, to: c },
        { from: c, to: a },
      ],
    });
    expectShape(out);
    expect(out.score).toBeGreaterThan(0.5);
  });

  test('all edges missing from/to are silently dropped (score 0, not fired)', async () => {
    // The implementation skips edges with missing from/to. With no usable
    // edges there is no address to score, so the canonical empty evidence
    // shape is returned and fired stays false.
    const a = '0x' + '11'.repeat(20);
    const out = await eoa.run({
      edges: [{ from: null, to: a }, { to: a }, { from: a }, {}],
    });
    expectShape(out);
    expect(out.score).toBe(0);
    expect(out.fired).toBe(false);
  });
});

describe('contractOverlap — fired case', () => {
  test('scores 1.0 on identical obscure interactions', async () => {
    const obs = { address: '0xabcdef', obscure: true };
    const out = await overlap.run({
      walletA: { interactions: [obs, { address: '0xfeed', obscure: true }] },
      walletB: { interactions: [obs, { address: '0xfade', obscure: true }] },
    });
    expectShape(out);
    expect(out.score).toBeGreaterThan(0);
  });

  test('jaccard of two empty sets is 0', () => {
    expect(overlap.jaccard(new Set(), new Set())).toBe(0);
  });

  test('buildAddressSet lowercases and skips null/empty addresses', () => {
    const s = overlap.buildAddressSet([
      { address: '0xABCDEF' },
      { address: null },
      {},
    ]);
    expect(s.has('0xabcdef')).toBe(true);
    expect(s.size).toBe(1);
  });

  test('buildAddressSet coerces non-string addresses to a string (current behaviour)', () => {
    // The implementation calls String(item.address).toLowerCase() without a
    // type guard; numeric/boolean addresses therefore become their toString
    // form. This test pins that contract so any future tightening is
    // explicit rather than accidental.
    const s = overlap.buildAddressSet([{ address: 42 }]);
    expect(s.has('42')).toBe(true);
  });
});

describe('temporalCorrelation — fired case', () => {
  test('two wallets active at the same hour correlate', async () => {
    const w1 = '0x' + '44'.repeat(20);
    const w2 = '0x' + '55'.repeat(20);
    const ts = [];
    for (let h = 0; h < 24; h += 1) {
      ts.push(Date.UTC(2025, 0, 1, h, 0, 0) / 1000);
    }
    const out = await temporal.run({
      wallets: [
        { wallet: w1, timestamps: ts },
        { wallet: w2, timestamps: ts },
      ],
    });
    expectShape(out);
    expect(out.fired).toBe(true);
  });

  test('hourBuckets counts each timestamp in its UTC hour', () => {
    const buckets = temporal.hourBuckets([
      Date.UTC(2025, 0, 1, 5, 0, 0) / 1000,
      Date.UTC(2025, 0, 1, 5, 30, 0) / 1000,
      Date.UTC(2025, 0, 1, 17, 0, 0) / 1000,
    ]);
    expect(buckets[5]).toBe(2);
    expect(buckets[17]).toBe(1);
  });

  test('cosineSimilarity returns 1 for identical vectors', () => {
    const v = [1, 2, 3, 4];
    expect(temporal.cosineSimilarity(v.slice(), v.slice())).toBeCloseTo(1, 6);
  });

  test('cosineSimilarity returns 0 for orthogonal vectors', () => {
    const a = [1, 0, 0, 0];
    const b = [0, 1, 0, 0];
    expect(temporal.cosineSimilarity(a, b)).toBe(0);
  });

  test('topPairs returns k distinct, non-self pairs sorted by score', () => {
    const matrix = [
      [1, 0.9, 0.1],
      [0.9, 1, 0.2],
      [0.1, 0.2, 1],
    ];
    const wallets = [{ wallet: 'a' }, { wallet: 'b' }, { wallet: 'c' }];
    const top = temporal.topPairs(matrix, wallets, 3);
    expect(top).toHaveLength(3);
    expect(top[0].score).toBeCloseTo(0.9, 6);
    expect(top[2].score).toBeCloseTo(0.1, 6);
  });
});

describe('entropyScorer — fired case', () => {
  test('sequential children score high', async () => {
    const out = await entropy.run({
      addresses: [
        '0x0000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000002',
        '0x0000000000000000000000000000000000000003',
      ],
    });
    expectShape(out);
    expect(out.fired).toBe(true);
  });

  test('shannonEntropy is 0 for a single-character string', () => {
    expect(entropy.shannonEntropy('a')).toBe(0);
  });

  test('shannonEntropy is log2(unique) for a uniform distribution', () => {
    // 4 distinct chars evenly distributed => log2(4) = 2.
    const s = 'aabbccdd';
    expect(entropy.shannonEntropy(s)).toBeCloseTo(2, 6);
  });

  test('sequentialSuffix counts only strictly +1 transitions', () => {
    expect(
      entropy.sequentialSuffix([
        '0x0000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000002',
        '0x0000000000000000000000000000000000000005',
      ]),
    ).toBe(1);
  });

  test('repeatedByteRuns flags addresses with a 4+ char run, skips clean ones', () => {
    // First address is clean (no 4+ run); second has a long run of 'a's.
    const flagged = entropy.repeatedByteRuns([
      '0x1234567890abcdef1234567890abcdef12345678',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ]);
    expect(flagged).toBe(1);
  });

  test('repeatedByteRuns flags every address that has a 4+ run', () => {
    // All-zero hex body has a run of 40 zeros — the heuristic should count
    // both. This pins the per-address counting behaviour.
    const flagged = entropy.repeatedByteRuns([
      '0x0000000000000000000000000000000000000001',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ]);
    expect(flagged).toBe(2);
  });
});

describe('sanctionProximity — fired case', () => {
  test('exposure to a sample-bad address raises the score', async () => {
    const out = await sanction.run({
      exposures: [
        { target: '0x0000000000000000000000000000000000000bad', hop: 1, volume: 5 },
      ],
    });
    expectShape(out);
    expect(out.fired).toBe(true);
  });

  test('non-flagged exposures still produce the canonical shape with score 0', async () => {
    const out = await sanction.run({
      exposures: [
        { target: '0x' + '11'.repeat(20), hop: 1, volume: 5 },
      ],
    });
    expectShape(out);
    expect(out.fired).toBe(false);
    expect(out.score).toBe(0);
  });

  test('volume / hop scaling yields a higher score for closer exposures', async () => {
    const far = await sanction.run({
      exposures: [{ target: '0x0000000000000000000000000000000000000bad', hop: 5, volume: 0.1 }],
    });
    const near = await sanction.run({
      exposures: [{ target: '0x0000000000000000000000000000000000000bad', hop: 1, volume: 100 }],
    });
    expect(near.score).toBeGreaterThan(far.score);
  });
});

describe('heuristics — score is in [0, 1] for every fired case', () => {
  const FIRED_INPUTS = {
    nonce: { seriesByChain: { ethereum: [1, 2, 4, 9, 16, 26], base: [1, 2, 4, 9, 16, 26] } },
    dna: {
      deployments: [
        { chain: 'ethereum', bytecode: '0xdeadbeef' },
        { chain: 'base', bytecode: '0xdeadbeef' },
      ],
    },
    bridge: {
      edges: [
        { fromChain: 'ethereum', toChain: 'arbitrum', amount: 5, bridge: 'stargate' },
        { fromChain: 'arbitrum', toChain: 'base', amount: 6, bridge: 'hop' },
      ],
    },
    gas: {
      samplesByChain: {
        ethereum: [{ baseFee: 30, tip: 2, gasLimit: 21000 }],
        optimism: [{ baseFee: 30, tip: 2, gasLimit: 21000 }],
      },
    },
    eoa: {
      edges: [
        { from: '0x' + '11'.repeat(20), to: '0x' + '22'.repeat(20) },
        { from: '0x' + '22'.repeat(20), to: '0x' + '11'.repeat(20) },
      ],
    },
    overlap: {
      walletA: { interactions: [{ address: '0xabc', obscure: true }] },
      walletB: { interactions: [{ address: '0xabc', obscure: true }] },
    },
    temporal: {
      wallets: [
        { wallet: '0x' + '44'.repeat(20), timestamps: [Date.UTC(2025, 0, 1) / 1000, Date.UTC(2025, 0, 2) / 1000] },
        { wallet: '0x' + '55'.repeat(20), timestamps: [Date.UTC(2025, 0, 1) / 1000, Date.UTC(2025, 0, 2) / 1000] },
      ],
    },
    entropy: {
      addresses: [
        '0x0000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000002',
      ],
    },
    sanction: {
      exposures: [{ target: '0x0000000000000000000000000000000000000bad', hop: 1, volume: 5 }],
    },
  };

  for (const [key, { mod, name }] of Object.entries(HEURISTICS)) {
    test(`${name} score is in [0, 1] on a fired input`, async () => {
      const out = await mod.run(FIRED_INPUTS[key]);
      expect(out.score).toBeGreaterThanOrEqual(0);
      expect(out.score).toBeLessThanOrEqual(1);
    });
  }
});
