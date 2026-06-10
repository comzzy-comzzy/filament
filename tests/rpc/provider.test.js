// tests/rpc/provider.test.js
const {
  getProvider,
  listConfiguredChains,
  clearProviderCache,
} = require('../../src/rpc/provider');
const { InvalidAddressError } = require('../../src/utils/errors');
const { SUPPORTED_CHAINS, CHAINS } = require('../../src/config/chains');
const { JsonRpcProvider } = require('ethers');

// Per-test env with a placeholder URL for every supported chain. Each test
// picks the subset it needs.
const FULL_ENV = {
  RPC_ETHEREUM: 'https://example.invalid/eth',
  RPC_ARBITRUM: 'https://example.invalid/arb',
  RPC_OPTIMISM: 'https://example.invalid/op',
  RPC_BASE: 'https://example.invalid/base',
  RPC_MANTLE: 'https://example.invalid/mantle',
  RPC_POLYGON: 'https://example.invalid/polygon',
  RPC_BNB: 'https://example.invalid/bnb',
};

beforeEach(() => {
  clearProviderCache();
});

describe('rpc/provider — getProvider()', () => {
  describe('unsupported chain', () => {
    test('throws InvalidAddressError for an unknown chain name', () => {
      let caught = null;
      try {
        getProvider('not_a_chain', { env: {} });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(InvalidAddressError);
      expect(caught.reason).toBe('unsupported_chain');
      expect(caught.address).toBe('not_a_chain');
    });

    test('throws for empty string, null, undefined, numbers, objects', () => {
      for (const bad of ['', null, undefined, 0, 42, {}, []]) {
        expect(() => getProvider(bad, { env: {} })).toThrow(InvalidAddressError);
      }
    });

    test('the InvalidAddressError carries the offending input as `address`', () => {
      try {
        getProvider('mystery', { env: {} });
      } catch (e) {
        expect(e.address).toBe('mystery');
        return;
      }
      throw new Error('expected throw');
    });
  });

  describe('missing env URL (tolerance)', () => {
    test('returns null when the env URL is missing entirely', () => {
      const env = {}; // no RPC_ETHEREUM
      expect(getProvider('ethereum', { env })).toBeNull();
    });

    test('returns null when the env URL is the empty string', () => {
      const env = { RPC_ETHEREUM: '' };
      expect(getProvider('ethereum', { env })).toBeNull();
    });

    test('returns null when the env URL is whitespace only', () => {
      const env = { RPC_ETHEREUM: '   ' };
      expect(getProvider('ethereum', { env })).toBeNull();
      const env2 = { RPC_ETHEREUM: '\t\n  ' };
      expect(getProvider('ethereum', { env: env2 })).toBeNull();
    });

    test('each supported chain is independently tolerated when its env is missing', () => {
      for (const chain of SUPPORTED_CHAINS) {
        expect(getProvider(chain, { env: {} })).toBeNull();
      }
    });
  });

  describe('happy path — resolving a real chain', () => {
    test('returns a JsonRpcProvider when the env URL is set', () => {
      const p = getProvider('ethereum', { env: FULL_ENV });
      expect(p).toBeInstanceOf(JsonRpcProvider);
    });

    test('resolves every supported chain to a JsonRpcProvider', () => {
      for (const chain of SUPPORTED_CHAINS) {
        const p = getProvider(chain, { env: FULL_ENV });
        expect(p).toBeInstanceOf(JsonRpcProvider);
      }
    });

    test('the returned provider is configured with the correct chainId and name', () => {
      // JsonRpcProvider stores the network config internally; we can introspect
      // it via the `_network` / `network` properties (stable across ethers v6
      // minor versions for our purposes).
      for (const chain of SUPPORTED_CHAINS) {
        const p = getProvider(chain, { env: FULL_ENV });
        // The network object holds the chainId/name we passed at construction.
        const net = p._network || p.network;
        expect(Number(net.chainId)).toBe(CHAINS[chain].chainId);
        expect(net.name).toBe(CHAINS[chain].name);
      }
    });

    test('the URL passed to JsonRpcProvider matches the env value', () => {
      const p = getProvider('arbitrum', { env: FULL_ENV });
      // ethers v6 stores the connection URL internally; the exact field name
      // has shifted across minors, so we check a couple of common locations.
      const url =
        (p._getConnection && p._getConnection().url) ||
        (p.connection && p.connection.url) ||
        (p._connection && p._connection.url);
      expect(url).toBe(FULL_ENV.RPC_ARBITRUM);
    });
  });

  describe('caching', () => {
    test('returns the same provider instance on repeat calls (cache hit)', () => {
      const a = getProvider('ethereum', { env: FULL_ENV });
      const b = getProvider('ethereum', { env: FULL_ENV });
      expect(a).toBe(b);
    });

    test('does not cache null results from missing-env lookups', () => {
      // First call: missing env -> null, NOT cached.
      const first = getProvider('ethereum', { env: {} });
      expect(first).toBeNull();
      // Second call with the env now populated should return a real provider.
      const second = getProvider('ethereum', { env: FULL_ENV });
      expect(second).toBeInstanceOf(JsonRpcProvider);
    });

    test('does not cache null results from whitespace-only lookups', () => {
      const first = getProvider('ethereum', { env: { RPC_ETHEREUM: '   ' } });
      expect(first).toBeNull();
      const second = getProvider('ethereum', { env: FULL_ENV });
      expect(second).toBeInstanceOf(JsonRpcProvider);
    });

    test('force=true bypasses the cache and constructs a new provider', () => {
      const a = getProvider('ethereum', { env: FULL_ENV });
      const b = getProvider('ethereum', { env: FULL_ENV, force: true });
      expect(a).not.toBe(b);
      expect(b).toBeInstanceOf(JsonRpcProvider);
    });

    test('clearProviderCache() empties the cache so the next call rebuilds', () => {
      const a = getProvider('ethereum', { env: FULL_ENV });
      clearProviderCache();
      const b = getProvider('ethereum', { env: FULL_ENV });
      expect(a).not.toBe(b);
    });

    test('cache is keyed per-chain (different chains get different providers)', () => {
      const a = getProvider('ethereum', { env: FULL_ENV });
      const b = getProvider('arbitrum', { env: FULL_ENV });
      expect(a).not.toBe(b);
    });
  });

  describe('env injection', () => {
    test('does not read process.env when an explicit env is passed', () => {
      // Save and clear process.env to prove the test is hermetic.
      const original = process.env.RPC_ETHEREUM;
      delete process.env.RPC_ETHEREUM;
      try {
        const p = getProvider('ethereum', { env: { RPC_ETHEREUM: 'https://example.invalid/injected' } });
        expect(p).toBeInstanceOf(JsonRpcProvider);
      } finally {
        if (original !== undefined) process.env.RPC_ETHEREUM = original;
      }
    });

    test('falls back to process.env when no env is supplied', () => {
      const original = process.env.RPC_ETHEREUM;
      process.env.RPC_ETHEREUM = 'https://example.invalid/from-proc-env';
      try {
        const p = getProvider('ethereum');
        expect(p).toBeInstanceOf(JsonRpcProvider);
      } finally {
        if (original === undefined) delete process.env.RPC_ETHEREUM;
        else process.env.RPC_ETHEREUM = original;
      }
    });
  });
});

describe('rpc/provider — listConfiguredChains()', () => {
  test('returns an empty array when no env URLs are set', () => {
    expect(listConfiguredChains({ env: {} })).toEqual([]);
  });

  test('returns all seven supported chains when every env URL is set', () => {
    const list = listConfiguredChains({ env: FULL_ENV });
    expect(list.length).toBe(7);
    for (const chain of SUPPORTED_CHAINS) {
      expect(list).toContain(chain);
    }
  });

  test('returns only the chains with non-empty env values', () => {
    const env = {
      RPC_ETHEREUM: 'https://example.invalid/eth',
      RPC_ARBITRUM: '',
      RPC_OPTIMISM: '   ',
      // base, mantle, polygon, bnb unset
    };
    const list = listConfiguredChains({ env });
    expect(list).toEqual(['ethereum']);
  });

  test('returns chains in the canonical SUPPORTED_CHAINS order', () => {
    const env = {
      RPC_BNB: 'https://example.invalid/bnb',
      RPC_ETHEREUM: 'https://example.invalid/eth',
      RPC_POLYGON: 'https://example.invalid/polygon',
    };
    const list = listConfiguredChains({ env });
    // Order must match SUPPORTED_CHAINS, not the env's insertion order.
    expect(list).toEqual(['ethereum', 'polygon', 'bnb']);
  });

  test('treats whitespace-only values as not configured', () => {
    const env = {
      RPC_ETHEREUM: '\t\n  ',
      RPC_ARBITRUM: 'https://example.invalid/arb',
    };
    const list = listConfiguredChains({ env });
    expect(list).toEqual(['arbitrum']);
  });
});

describe('rpc/provider — clearProviderCache()', () => {
  test('is idempotent on an empty cache', () => {
    expect(() => clearProviderCache()).not.toThrow();
    expect(() => clearProviderCache()).not.toThrow();
  });

  test('forces a fresh provider construction after a clear', () => {
    const a = getProvider('optimism', { env: FULL_ENV });
    clearProviderCache();
    const b = getProvider('optimism', { env: FULL_ENV });
    expect(a).not.toBe(b);
    // Both must still be valid providers.
    expect(a).toBeInstanceOf(JsonRpcProvider);
    expect(b).toBeInstanceOf(JsonRpcProvider);
  });
});

describe('rpc/provider — supported chains surface', () => {
  test('the seven required chains are all present', () => {
    for (const required of [
      'ethereum',
      'arbitrum',
      'optimism',
      'base',
      'mantle',
      'polygon',
      'bnb',
    ]) {
      expect(SUPPORTED_CHAINS).toContain(required);
    }
  });

  test('every supported chain has a chainId and envKey', () => {
    for (const chain of SUPPORTED_CHAINS) {
      const c = CHAINS[chain];
      expect(typeof c.chainId).toBe('number');
      expect(typeof c.envKey).toBe('string');
      expect(c.envKey.startsWith('RPC_')).toBe(true);
    }
  });
});
