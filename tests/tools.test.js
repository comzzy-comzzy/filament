// tests/tools.test.js
// Tool adapter tests: schema validation, handler smoke calls, and the
// canonical adapter shape `{name, description, inputSchema, handler}`.

const { TOOLS, listToolNames, getTool } = require('../src/tools');
const { InvalidAddressError, SchemaError } = require('../src/utils/errors');

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

describe('tool registry', () => {
  test('exposes exactly 11 tools with the expected names', () => {
    expect(TOOLS).toHaveLength(11);
    expect(listToolNames().sort()).toEqual(EXPECTED_NAMES.slice().sort());
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

  test('getTool finds each registered name and rejects unknowns', () => {
    for (const name of EXPECTED_NAMES) {
      expect(getTool(name)).not.toBeNull();
    }
    expect(getTool('not_a_real_tool')).toBeNull();
  });
});

describe('tool inputSchema validation', () => {
  test('stitch_identity rejects a bad wallet', () => {
    const tool = getTool('stitch_identity');
    expect(() => tool.validate({ wallet: 'nope' })).toThrow(InvalidAddressError);
  });

  test('stitch_identity requires a chains array', () => {
    const tool = getTool('stitch_identity');
    expect(() => tool.validate({ wallet: '0x' + 'aa'.repeat(20), chains: [] })).toThrow(SchemaError);
  });

  test('temporal_activity_correlation needs >= 2 wallets', () => {
    const tool = getTool('temporal_activity_correlation');
    expect(() => tool.validate({ wallets: ['0x' + 'aa'.repeat(20)] })).toThrow(SchemaError);
  });

  test('sanction_proximity_mapper accepts a valid wallet', () => {
    const tool = getTool('sanction_proximity_mapper');
    const out = tool.validate({ wallet: '0x' + 'aa'.repeat(20), depth: 2 });
    expect(out.wallet).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(out.depth).toBe(2);
  });
});

describe('tool handler smoke calls', () => {
  test('nonce_pattern_match returns a similarity score', async () => {
    const tool = getTool('nonce_pattern_match');
    const out = await tool.handler(
      { wallet: '0x' + 'aa'.repeat(20), chains: ['ethereum', 'base'] },
      {
        nonceSeries: {
          ethereum: [1, 2, 4, 9, 16],
          base: [1, 2, 4, 9, 16],
        },
      },
    );
    expect(typeof out.similarity).toBe('number');
  });

  test('identity_confidence_report aggregates provided heuristic results', async () => {
    const tool = getTool('identity_confidence_report');
    const wallet = '0x' + 'aa'.repeat(20);
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
  });
});
