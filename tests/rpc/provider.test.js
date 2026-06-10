// tests/rpc/provider.test.js
const { getProvider, listConfiguredChains, clearProviderCache } = require('../../src/rpc/provider');
const { InvalidAddressError } = require('../../src/utils/errors');

describe('rpc/provider', () => {
  test('returns null when the env URL is missing', () => {
    clearProviderCache();
    const env = {}; // no RPC_ETHEREUM
    expect(getProvider('ethereum', { env })).toBeNull();
  });

  test('throws InvalidAddressError for an unsupported chain', () => {
    expect(() => getProvider('not_a_chain', { env: {} })).toThrow(InvalidAddressError);
  });

  test('returns a provider when the env URL is set', () => {
    clearProviderCache();
    const env = { RPC_ETHEREUM: 'https://example.invalid/eth' };
    const p = getProvider('ethereum', { env });
    expect(p).not.toBeNull();
  });

  test('listConfiguredChains returns only chains with URLs', () => {
    const env = { RPC_ETHEREUM: 'https://example.invalid/eth' };
    const list = listConfiguredChains({ env });
    expect(list).toContain('ethereum');
  });
});
