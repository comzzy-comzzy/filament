// src/config/chains.js
// Static registry of the seven EVM chains Filament supports. The `envKey`
// field points at the corresponding `RPC_*` environment variable; the
// provider module looks it up on demand.

const CHAINS = {
  ethereum: {
    name: 'ethereum',
    chainId: 1,
    envKey: 'RPC_ETHEREUM',
    nativeSymbol: 'ETH',
    explorer: 'https://etherscan.io',
  },
  arbitrum: {
    name: 'arbitrum',
    chainId: 42161,
    envKey: 'RPC_ARBITRUM',
    nativeSymbol: 'ETH',
    explorer: 'https://arbiscan.io',
  },
  optimism: {
    name: 'optimism',
    chainId: 10,
    envKey: 'RPC_OPTIMISM',
    nativeSymbol: 'ETH',
    explorer: 'https://optimistic.etherscan.io',
  },
  base: {
    name: 'base',
    chainId: 8453,
    envKey: 'RPC_BASE',
    nativeSymbol: 'ETH',
    explorer: 'https://basescan.org',
  },
  mantle: {
    name: 'mantle',
    chainId: 5000,
    envKey: 'RPC_MANTLE',
    nativeSymbol: 'MNT',
    explorer: 'https://mantlescan.xyz',
  },
  polygon: {
    name: 'polygon',
    chainId: 137,
    envKey: 'RPC_POLYGON',
    nativeSymbol: 'MATIC',
    explorer: 'https://polygonscan.com',
  },
  bnb: {
    name: 'bnb',
    chainId: 56,
    envKey: 'RPC_BNB',
    nativeSymbol: 'BNB',
    explorer: 'https://bscscan.com',
  },
};

const SUPPORTED_CHAINS = Object.freeze(Object.keys(CHAINS));

function getChain(name) {
  return CHAINS[name] || null;
}

function isSupportedChain(name) {
  return Boolean(getChain(name));
}

function listChains() {
  return SUPPORTED_CHAINS.slice();
}

module.exports = { CHAINS, SUPPORTED_CHAINS, getChain, isSupportedChain, listChains };
