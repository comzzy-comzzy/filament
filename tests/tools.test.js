// tests/tools.test.js
// Tool adapter tests: the canonical `{name, description, inputSchema, handler}`
// shape, schema validation, handler smoke calls, ctx-based heuristic
// invocation, and JSON-serialisable outputs.

const { TOOLS, listToolNames, getTool } = require('../src/tools');
const { InvalidAddressError, SchemaError } = require('../src/utils/errors');
const { toChecksumAddress } = require('../src/utils/checksum');

const EXPECTED_NAMES = [
  'stitch_identity',
  'nonce_pattern_match',
  'deployment_dna_scan',
  'bridge_hop_tracer',
  'gas_behavior_fingerprint',
  'eoa_cluster_graph',
  'contract_interaction_overlap',
  'temporal_activity_correlation',
  'entropy_address_scorer',
  'sanction_proximity_mapper',
  'identity_confidence_report',
];

const W = () => toChecksumAddress('0x' + 'ab'.repeat(20));

describe('tool registry', () => {
  test('exposes exactly 11 tools with the expected names', () => {
    expect(TOOLS).toHaveLength(11);
    expect(listToolNames().sort()).toEqual(EXPECTED_NAMES.slice().sort());
  });

  test('all tool names are unique', () => {
    const names = listToolNames();
    expect(new Set(names).size).toBe(names.length);
  });

  test('all tool names are snake_case strings', () => {
    for (const name of listToolNames()) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  test('every tool has a non-empty description', () => {
    for (const t of TOOLS) {
      expect(typeof t.description).toBe('string');
      expect(t.description.trim().length).toBeGreaterThan(0);
    }
  });

  test('every tool has the canonical adapter shape', () => {
    for (const t of TOOLS) {
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema).toBeDefined();
      expect(t.inputSchema.type).toBe('object');
      expect(typeof t.handler).toBe('function');
    }
  });

  test('every tool inputSchema declares additionalProperties:false (strict)', () => {
    for (const t of TOOLS) {
      // additionalProperties may be omitted on the root, but where present it
      // must be false. The current contract requires it on every tool.
      expect(t.inputSchema.additionalProperties).toBe(false);
    }
  });

  test('every tool inputSchema lists at least one required field', () => {
    for (const t of TOOLS) {
      expect(Array.isArray(t.inputSchema.required)).toBe(true);
      expect(t.inputSchema.required.length).toBeGreaterThan(0);
    }
  });

  test('every tool inputSchema.properties is a non-empty object', () => {
    for (const t of TOOLS) {
      expect(typeof t.inputSchema.properties).toBe('object');
      expect(Object.keys(t.inputSchema.properties).length).toBeGreaterThan(0);
    }
  });

  test('every required field is also present in properties', () => {
    for (const t of TOOLS) {
      const required = t.inputSchema.required || [];
      const propKeys = Object.keys(t.inputSchema.properties || {});
      for (const r of required) {
        expect(propKeys).toContain(r);
      }
    }
  });

  test('getTool finds each registered name and rejects unknowns', () => {
    for (const name of EXPECTED_NAMES) {
      expect(getTool(name)).not.toBeNull();
    }
    expect(getTool('not_a_real_tool')).toBeNull();
  });

  test('registry is frozen (cannot be mutated at runtime)', () => {
    expect(Object.isFrozen(TOOLS)).toBe(true);
  });
});

describe('tool inputSchema validation', () => {
  test('stitch_identity rejects a bad wallet', () => {
    const tool = getTool('stitch_identity');
    expect(() => tool.validate({ wallet: 'nope' })).toThrow(InvalidAddressError);
  });

  test('stitch_identity rejects non-object input', () => {
    const tool = getTool('stitch_identity');
    expect(() => tool.validate(null)).toThrow(SchemaError);
    expect(() => tool.validate('oops')).toThrow(SchemaError);
  });

  test('stitch_identity requires a non-empty chains array', () => {
    const tool = getTool('stitch_identity');
    expect(() =>
      tool.validate({ wallet: W(), chains: [] }),
    ).toThrow(SchemaError);
  });

  test('temporal_activity_correlation needs >= 2 wallets', () => {
    const tool = getTool('temporal_activity_correlation');
    expect(() => tool.validate({ wallets: [W()] })).toThrow(SchemaError);
    expect(() => tool.validate({ wallets: 'not an array' })).toThrow(SchemaError);
  });

  test('sanction_proximity_mapper accepts a valid wallet', () => {
    const tool = getTool('sanction_proximity_mapper');
    const out = tool.validate({ wallet: W(), depth: 2 });
    expect(out.wallet).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(out.depth).toBe(2);
  });

  test('contract_interaction_overlap validates both wallets', () => {
    const tool = getTool('contract_interaction_overlap');
    expect(() => tool.validate({ walletA: 'nope', walletB: W() })).toThrow(InvalidAddressError);
    expect(() => tool.validate({ walletA: W(), walletB: 'nope' })).toThrow(InvalidAddressError);
  });

  test('every tool rejects null/undefined input via its handler', async () => {
    for (const t of TOOLS) {
      // Handlers invoke validate, which throws SchemaError on non-object
      // input. We let the error propagate to the caller.
      await expect(t.handler(null, {})).rejects.toBeDefined();
    }
  });
});

describe('tool handlers — async, return JSON-serialisable result', () => {
  const VALID_INPUTS = {
    stitch_identity: { wallet: W(), chains: ['ethereum', 'base'] },
    nonce_pattern_match: { wallet: W(), chains: ['ethereum', 'base'] },
    deployment_dna_scan: { wallet: W() },
    bridge_hop_tracer: { wallet: W(), depth: 2 },
    gas_behavior_fingerprint: { wallet: W(), chains: ['ethereum', 'base'] },
    eoa_cluster_graph: { wallet: W(), chains: ['ethereum', 'base'], depth: 2 },
    contract_interaction_overlap: { walletA: W(), walletB: W() },
    temporal_activity_correlation: { wallets: [W(), W()] },
    entropy_address_scorer: { wallet: W(), addresses: ['0x' + '1'.repeat(40), '0x' + '2'.repeat(40)] },
    sanction_proximity_mapper: { wallet: W(), depth: 2 },
    identity_confidence_report: { wallet: W() },
  };

  for (const name of EXPECTED_NAMES) {
    test(`${name} handler is async and returns a Promise`, async () => {
      const tool = getTool(name);
      const ret = tool.handler(VALID_INPUTS[name], {});
      expect(ret).toBeInstanceOf(Promise);
      await ret; // settle the promise
    });

    test(`${name} handler result is JSON-serialisable`, async () => {
      const tool = getTool(name);
      const result = await tool.handler(VALID_INPUTS[name], {});
      expect(() => JSON.stringify(result)).not.toThrow();
      const round = JSON.parse(JSON.stringify(result));
      expect(round).toEqual(result);
    });
  }
});

describe('tool handlers — accept a ctx object', () => {
  test('all 11 handlers accept an empty ctx without crashing', async () => {
    const VALID_INPUTS = {
      stitch_identity: { wallet: W(), chains: ['ethereum'] },
      nonce_pattern_match: { wallet: W(), chains: ['ethereum'] },
      deployment_dna_scan: { wallet: W() },
      bridge_hop_tracer: { wallet: W(), depth: 1 },
      gas_behavior_fingerprint: { wallet: W(), chains: ['ethereum'] },
      eoa_cluster_graph: { wallet: W(), chains: ['ethereum'], depth: 1 },
      contract_interaction_overlap: { walletA: W(), walletB: W() },
      temporal_activity_correlation: { wallets: [W(), W()] },
      entropy_address_scorer: { wallet: W(), addresses: ['0x' + '1'.repeat(40), '0x' + '2'.repeat(40)] },
      sanction_proximity_mapper: { wallet: W(), depth: 1 },
      identity_confidence_report: { wallet: W() },
    };
    for (const name of EXPECTED_NAMES) {
      const tool = getTool(name);
      // Empty ctx should be tolerated. Tools that read ctx.<x>[wallet] will
      // get undefined and degrade gracefully to empty/zero defaults.
      const result = await tool.handler(VALID_INPUTS[name], {});
      expect(result).toBeDefined();
    }
  });

  test('all 11 handlers accept a missing ctx (default {})', async () => {
    const VALID_INPUTS = {
      stitch_identity: { wallet: W(), chains: ['ethereum'] },
      nonce_pattern_match: { wallet: W(), chains: ['ethereum'] },
      deployment_dna_scan: { wallet: W() },
      bridge_hop_tracer: { wallet: W(), depth: 1 },
      gas_behavior_fingerprint: { wallet: W(), chains: ['ethereum'] },
      eoa_cluster_graph: { wallet: W(), chains: ['ethereum'], depth: 1 },
      contract_interaction_overlap: { walletA: W(), walletB: W() },
      temporal_activity_correlation: { wallets: [W(), W()] },
      entropy_address_scorer: { wallet: W(), addresses: ['0x' + '1'.repeat(40), '0x' + '2'.repeat(40)] },
      sanction_proximity_mapper: { wallet: W(), depth: 1 },
      identity_confidence_report: { wallet: W() },
    };
    for (const name of EXPECTED_NAMES) {
      const tool = getTool(name);
      // No second arg at all — handlers default ctx to {}.
      const result = await tool.handler(VALID_INPUTS[name]);
      expect(result).toBeDefined();
    }
  });
});

describe('tool handlers — call the appropriate heuristic via ctx', () => {
  test('nonce_pattern_match returns a similarity score driven by ctx', async () => {
    const tool = getTool('nonce_pattern_match');
    const series = [1, 2, 4, 9, 16, 26];
    const out = await tool.handler(
      { wallet: W(), chains: ['ethereum', 'base'] },
      {
        nonceSeries: {
          ethereum: series,
          base: series,
        },
      },
    );
    expect(typeof out.similarity).toBe('number');
    expect(out.similarity).toBeGreaterThan(0.2);
    expect(out.fired).toBe(true);
  });

  test('identity_confidence_report aggregates provided heuristic results', async () => {
    const tool = getTool('identity_confidence_report');
    const wallet = W();
    const out = await tool.handler(
      { wallet },
      {
        heuristicResults: {
          [wallet]: {
            noncePattern: { score: 0.9, fired: true, evidence: {} },
            eoaCluster: { score: 0.9, fired: true, evidence: {} },
            contractOverlap: { score: 0.9, fired: true, evidence: {} },
          },
        },
      },
    );
    expect(['High', 'Probable', 'Speculative']).toContain(out.tier);
    expect(out.perHeuristic.length).toBeGreaterThan(0);
    expect(typeof out.confidence).toBe('number');
  });

  test('bridge_hop_tracer builds a graph payload from ctx.bridgeEdges', async () => {
    const tool = getTool('bridge_hop_tracer');
    const wallet = W();
    const out = await tool.handler(
      { wallet, depth: 2 },
      {
        bridgeEdges: {
          [wallet]: [
            { from: wallet, to: '0x' + 'cc'.repeat(20), fromChain: 'ethereum', toChain: 'arbitrum', amount: 5 },
          ],
        },
      },
    );
    expect(out.graph).toBeDefined();
    expect(Array.isArray(out.graph.nodes)).toBe(true);
    expect(out.graph.nodes).toContain(wallet);
  });

  test('sanction_proximity_mapper surfaces flagged exposures from ctx', async () => {
    const tool = getTool('sanction_proximity_mapper');
    const wallet = W();
    const out = await tool.handler(
      { wallet, depth: 2 },
      {
        sanctionExposures: {
          [wallet]: [
            { target: '0x0000000000000000000000000000000000000bad', hop: 1, volume: 5 },
          ],
        },
      },
    );
    expect(out.flagged.length).toBeGreaterThan(0);
    expect(out.fired).toBe(true);
  });

  test('entropy_address_scorer reads child addresses from ctx', async () => {
    const tool = getTool('entropy_address_scorer');
    const wallet = W();
    const out = await tool.handler(
      { wallet },
      {
        childAddresses: {
          [wallet]: [
            '0x0000000000000000000000000000000000000001',
            '0x0000000000000000000000000000000000000002',
            '0x0000000000000000000000000000000000000003',
          ],
        },
      },
    );
    expect(typeof out.entropyScore).toBe('number');
    expect(out.fired).toBe(true);
  });

  test('contract_interaction_overlap reads per-wallet interactions from ctx', async () => {
    const tool = getTool('contract_interaction_overlap');
    const a = W();
    const b = W();
    const out = await tool.handler(
      { walletA: a, walletB: b },
      {
        interactions: {
          [a]: [{ address: '0xabcdef', obscure: true }],
          [b]: [{ address: '0xabcdef', obscure: true }],
        },
      },
    );
    expect(out.sharedContracts).toContain('0xabcdef');
    expect(out.overlapScore).toBeGreaterThan(0);
  });

  test('deployment_dna_scan reads deployments from ctx', async () => {
    const tool = getTool('deployment_dna_scan');
    const wallet = W();
    const out = await tool.handler(
      { wallet },
      {
        deployments: {
          [wallet]: [
            { chain: 'ethereum', bytecode: '0xdeadbeef' },
            { chain: 'base', bytecode: '0xdeadbeef' },
          ],
        },
      },
    );
    expect(typeof out.fingerprint).toBe('string');
    expect(out.matchedWallets).toBeGreaterThan(0);
    expect(out.fired).toBe(true);
  });

  test('gas_behavior_fingerprint reads per-chain gas samples from ctx', async () => {
    const tool = getTool('gas_behavior_fingerprint');
    const wallet = W();
    const samples = { baseFee: 30, tip: 2, gasLimit: 21000 };
    const out = await tool.handler(
      { wallet, chains: ['ethereum', 'base'] },
      {
        gasSamples: {
          ethereum: { [wallet]: [samples, samples, samples] },
          base: { [wallet]: [samples, samples, samples] },
        },
      },
    );
    expect(out.biddingStyle).toBe('fast');
    expect(out.similarity).toBeGreaterThan(0.9);
  });

  test('eoa_cluster_graph reads funding edges from ctx', async () => {
    const tool = getTool('eoa_cluster_graph');
    const wallet = W();
    const peer = '0x' + 'cc'.repeat(20);
    const out = await tool.handler(
      { wallet, chains: ['ethereum'], depth: 1 },
      {
        fundingEdges: {
          [wallet]: [
            { from: wallet, to: peer },
            { from: peer, to: wallet },
          ],
        },
      },
    );
    expect(Array.isArray(out.edges)).toBe(true);
    expect(out.edges.length).toBe(2);
  });

  test('temporal_activity_correlation reads activity timestamps from ctx', async () => {
    const tool = getTool('temporal_activity_correlation');
    // Use the same checksummed form for both the request and the ctx so
    // that the tool's post-validate ctx lookup hits.
    const w1 = W();
    const w2 = toChecksumAddress('0x' + 'cd'.repeat(20));
    const ts = [];
    for (let h = 0; h < 24; h += 1) {
      ts.push(Date.UTC(2025, 0, 1, h, 0, 0) / 1000);
    }
    const out = await tool.handler(
      { wallets: [w1, w2], chains: ['ethereum'] },
      {
        activityTimestamps: { [w1]: ts, [w2]: ts },
      },
    );
    expect(Array.isArray(out.correlationMatrix)).toBe(true);
    expect(out.fired).toBe(true);
  });

  test('stitch_identity uses ctx.getProvider and tolerates null providers', async () => {
    const tool = getTool('stitch_identity');
    const out = await tool.handler(
      { wallet: W(), chains: ['ethereum', 'base'] },
      {
        getProvider: () => null, // no RPC configured
      },
    );
    expect(out.perChain.ethereum).toEqual({ skipped: true, reason: 'no_rpc_configured' });
    expect(out.perChain.base).toEqual({ skipped: true, reason: 'no_rpc_configured' });
  });
});

describe('tool handlers — return shape includes tool-specific output fields', () => {
  test('stitch_identity returns wallet, chains, depth, perChain', async () => {
    const out = await getTool('stitch_identity').handler(
      { wallet: W(), chains: ['ethereum'], depth: 3 },
      { getProvider: () => null },
    );
    expect(out).toEqual(
      expect.objectContaining({
        wallet: expect.any(String),
        chains: expect.arrayContaining(['ethereum']),
        depth: 3,
        perChain: expect.objectContaining({ ethereum: expect.any(Object) }),
      }),
    );
  });

  test('nonce_pattern_match returns wallet, chains, similarity, fired', async () => {
    const out = await getTool('nonce_pattern_match').handler(
      { wallet: W(), chains: ['ethereum'] },
      { nonceSeries: { ethereum: [] } },
    );
    expect(out).toEqual(
      expect.objectContaining({
        wallet: expect.any(String),
        chains: expect.arrayContaining(['ethereum']),
        similarity: expect.any(Number),
        fired: expect.any(Boolean),
      }),
    );
  });

  test('identity_confidence_report returns wallet, confidence, tier, perHeuristic, weights', async () => {
    const out = await getTool('identity_confidence_report').handler(
      { wallet: W() },
      {},
    );
    expect(out).toEqual(
      expect.objectContaining({
        wallet: expect.any(String),
        confidence: expect.any(Number),
        tier: expect.stringMatching(/^(High|Probable|Speculative)$/),
        perHeuristic: expect.any(Array),
        weights: expect.any(Object),
        graphPayload: expect.objectContaining({ nodes: expect.any(Array), edges: expect.any(Array) }),
      }),
    );
  });

  test('bridge_hop_tracer returns graph payload', async () => {
    const out = await getTool('bridge_hop_tracer').handler(
      { wallet: W(), depth: 2 },
      {},
    );
    expect(out).toEqual(
      expect.objectContaining({
        wallet: expect.any(String),
        depth: 2,
        graph: expect.objectContaining({ nodes: expect.any(Array), edges: expect.any(Array) }),
        score: expect.any(Number),
        fired: expect.any(Boolean),
      }),
    );
  });

  test('sanction_proximity_mapper returns flagged array', async () => {
    const out = await getTool('sanction_proximity_mapper').handler(
      { wallet: W(), depth: 2 },
      {},
    );
    expect(out).toEqual(
      expect.objectContaining({
        wallet: expect.any(String),
        depth: 2,
        tree: expect.any(Array),
        flagged: expect.any(Array),
        score: expect.any(Number),
        fired: expect.any(Boolean),
      }),
    );
  });

  test('entropy_address_scorer returns entropyScore and derivationHypothesis', async () => {
    const out = await getTool('entropy_address_scorer').handler(
      { wallet: W(), addresses: ['0x' + '1'.repeat(40), '0x' + '2'.repeat(40)] },
      {},
    );
    expect(out).toEqual(
      expect.objectContaining({
        wallet: expect.any(String),
        entropyScore: expect.any(Number),
        derivationHypothesis: expect.any(String),
        fired: expect.any(Boolean),
      }),
    );
  });

  test('gas_behavior_fingerprint returns biddingStyle label', async () => {
    const out = await getTool('gas_behavior_fingerprint').handler(
      { wallet: W(), chains: ['ethereum'] },
      { gasSamples: { ethereum: { [W()]: [{ baseFee: 30, tip: 2, gasLimit: 21000 }] } } },
    );
    expect(out).toEqual(
      expect.objectContaining({
        wallet: expect.any(String),
        biddingStyle: expect.stringMatching(/^(fast|moderate|conservative)$/),
        similarity: expect.any(Number),
        fired: expect.any(Boolean),
      }),
    );
  });

  test('deployment_dna_scan returns fingerprint and matchedWallets', async () => {
    const out = await getTool('deployment_dna_scan').handler(
      { wallet: W() },
      {
        deployments: {
          [W()]: [
            { chain: 'ethereum', bytecode: '0xdeadbeef' },
            { chain: 'base', bytecode: '0xdeadbeef' },
          ],
        },
      },
    );
    expect(out).toEqual(
      expect.objectContaining({
        wallet: expect.any(String),
        fingerprint: expect.any(String),
        matchedWallets: expect.any(Number),
        fired: expect.any(Boolean),
      }),
    );
  });

  test('eoa_cluster_graph returns adjacency / centralCandidates / score', async () => {
    const out = await getTool('eoa_cluster_graph').handler(
      { wallet: W(), chains: ['ethereum'], depth: 1 },
      {},
    );
    expect(out).toEqual(
      expect.objectContaining({
        wallet: expect.any(String),
        depth: 1,
        edges: expect.any(Array),
        clusterSize: expect.any(Number),
        centralCandidates: expect.any(Array),
        score: expect.any(Number),
        fired: expect.any(Boolean),
      }),
    );
  });

  test('contract_interaction_overlap returns sharedContracts and jaccard', async () => {
    const out = await getTool('contract_interaction_overlap').handler(
      { walletA: W(), walletB: W() },
      {},
    );
    expect(out).toEqual(
      expect.objectContaining({
        walletA: expect.any(String),
        walletB: expect.any(String),
        sharedContracts: expect.any(Array),
        jaccard: expect.any(Number),
        obscureOverlap: expect.any(Number),
        fired: expect.any(Boolean),
      }),
    );
  });

  test('temporal_activity_correlation returns correlationMatrix and topPairs', async () => {
    const out = await getTool('temporal_activity_correlation').handler(
      { wallets: [W(), W()] },
      {},
    );
    expect(out).toEqual(
      expect.objectContaining({
        wallets: expect.any(Array),
        correlationMatrix: expect.any(Array),
        topPairs: expect.any(Array),
        timezoneHint: expect.any(String),
        score: expect.any(Number),
        fired: expect.any(Boolean),
      }),
    );
  });
});

describe('tool handlers — never throw on bad input, wrap as SchemaError', () => {
  test('stitch_identity rejects a missing wallet', async () => {
    await expect(
      getTool('stitch_identity').handler({}, { getProvider: () => null }),
    ).rejects.toBeDefined();
  });

  test('nonce_pattern_match rejects a missing wallet', async () => {
    await expect(
      getTool('nonce_pattern_match').handler({}, {}),
    ).rejects.toBeDefined();
  });

  test('deployment_dna_scan rejects a missing wallet', async () => {
    await expect(
      getTool('deployment_dna_scan').handler({}, {}),
    ).rejects.toBeDefined();
  });

  test('contract_interaction_overlap rejects missing walletA/walletB', async () => {
    await expect(
      getTool('contract_interaction_overlap').handler({}, {}),
    ).rejects.toBeDefined();
  });
});
