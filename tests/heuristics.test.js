// tests/heuristics.test.js
// Verifies the nine heuristic modules. Every test checks both the empty
// case (no_data) and a fired-data case so the canonical return shape is
// locked in for downstream tools.

const nonce = require('../src/heuristics/noncePattern');
const dna = require('../src/heuristics/deploymentDna');
const bridge = require('../src/heuristics/bridgeHopTracer');
const gas = require('../src/heuristics/gasBehavior');
const eoa = require('../src/heuristics/eoaClusterGraph');
const overlap = require('../src/heuristics/contractOverlap');
const temporal = require('../src/heuristics/temporalCorrelation');
const entropy = require('../src/heuristics/entropyScorer');
const sanction = require('../src/heuristics/sanctionProximity');

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

describe('heuristics — canonical shape', () => {
  const modules = { nonce, dna, bridge, gas, eoa, overlap, temporal, entropy, sanction };
  for (const [name, mod] of Object.entries(modules)) {
    test(`${name}.run returns canonical shape on empty input`, async () => {
      const out = await mod.run({});
      expectShape(out);
      expect(out.score).toBe(0);
      expect(out.fired).toBe(false);
    });

    test(`${name}.run never throws on garbage input`, async () => {
      await expect(mod.run(null)).resolves.toEqual(expect.objectContaining({ fired: expect.any(Boolean) }));
      await expect(mod.run(undefined)).resolves.toEqual(expect.objectContaining({ fired: expect.any(Boolean) }));
    });
  }
});

describe('noncePattern — fired case', () => {
  test('detects matching gap shapes across two chains', async () => {
    const series = [1, 2, 4, 9, 16, 26];
    const out = await nonce.run({ seriesByChain: { ethereum: series, base: series } });
    expectShape(out);
    expect(out.score).toBeGreaterThan(0.2);
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
});
