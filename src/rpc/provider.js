// src/rpc/provider.js
// Resolve an ethers v6 `JsonRpcProvider` for a given chain by reading the
// corresponding `RPC_*` environment variable. Missing URLs are tolerated:
// `getProvider` returns `null` so callers can skip the chain gracefully.

const { FetchRequest, JsonRpcProvider } = require('ethers');
const { isSupportedChain, getChain } = require('../config/chains');
const { InvalidAddressError } = require('../utils/errors');

const providerCache = new Map();
const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS || 10_000);

function getProvider(chainName, { env = process.env, force = false } = {}) {
  if (!isSupportedChain(chainName)) {
    throw new InvalidAddressError(chainName, 'unsupported_chain');
  }
  if (!force && providerCache.has(chainName)) {
    return providerCache.get(chainName);
  }
  const chain = getChain(chainName);
  const url = env[chain.envKey];
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return null;
  }
  const request = new FetchRequest(url.trim());
  request.timeout = RPC_TIMEOUT_MS;
  const network = {
    chainId: chain.chainId,
    name: chain.name,
  };
  const provider = new JsonRpcProvider(request, network, { staticNetwork: true });
  providerCache.set(chainName, provider);
  return provider;
}

function clearProviderCache() {
  providerCache.clear();
}

function listConfiguredChains({ env = process.env } = {}) {
  // Return only chains that have a usable RPC URL configured. "Usable"
  // matches the same definition as getProvider: non-empty after trim.
  const configured = [];
  for (const name of require('../config/chains').SUPPORTED_CHAINS) {
    const chain = getChain(name);
    const url = env[chain.envKey];
    if (typeof url === 'string' && url.trim() !== '') {
      configured.push(name);
    }
  }
  return configured;
}

module.exports = { getProvider, clearProviderCache, listConfiguredChains };
