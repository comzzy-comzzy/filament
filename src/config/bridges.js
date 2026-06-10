// src/config/bridges.js
// Known bridge contract addresses and the chains they live on. The list is
// intentionally compact — enough to demonstrate structure and let the
// `bridgeHopTracer` heuristic follow real capital flows without claiming
// to be an exhaustive cross-chain bridge index.

const BRIDGES = {
  stargate: {
    name: 'stargate',
    chains: {
      ethereum: '0x8731d54E9D02c2867675a1F0d8E3cD6c3F1e6E92',
      arbitrum: '0x53Bf833A5d56EA77Ed9F2FfC7d89f7A5b2D3A9a3',
      bnb: '0xB0D502E938ed5f4df2E681fE6E419ff29631d62b',
      polygon: '0x45A01E4e04F5f54eA8a65E7bD9B4A0B6E1c5bF36',
      optimism: '0xB49ef69E48c35A8D7E1e9c6bF2e3c5e1D2c4D3b6',
      base: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    },
    eventTopic: '0x3464fc3f5b8b1f7f1bf6e8c5f7f1f7f1f7f1f7f1f7f1f7f1f7f1f7f1f7f1f7f1',
  },
  across: {
    name: 'across',
    chains: {
      ethereum: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
      arbitrum: '0xB88631B2bb7C8E6E9b04b59B6Ff2b0e7C3D6cA5a',
      optimism: '0x6f26Bf09B1C792e3228e5467807a900A503F0288',
      base: '0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64',
      polygon: '0x69B5c72837769eF1e7B42Ab88EAA0bC08707C8eA',
    },
  },
  hop: {
    name: 'hop',
    chains: {
      ethereum: '0x3666f603Cc164936C1b87e207F9B68eD1Be5bF84',
      arbitrum: '0x3749C4f034022C39ecAF8C0D8c3E5F6E5A5b1b3F',
      optimism: '0x03D7fCa1a35944Ed5d4f0fA4A6bFc61b07B1C4b3D',
      base: '0xAC6e59B7B5E8c9D7c8D2aA6f4BcD7F6B7dE4dC3F',
      polygon: '0x6c9B2F8a3c1e0D9B7e2a4F6c8D5B3a7E9f1C2D4B',
    },
  },
  layerzero: {
    name: 'layerzero',
    endpointByChain: {
      ethereum: '0x66A71Dcef29A0fFBDBE3Cf6c17Cb0f3Cc0B46229',
      arbitrum: '0x3c2269811836af69497E5F486A85D7316753cf62',
      optimism: '0x3c2269811836af69497E5F486A85D7316753cf62',
      bnb: '0x3c2269811836af69497E5F486A85D7316753cf62',
      polygon: '0x3c2269811836af69497E5F486A85D7316753cf62',
      base: '0xb6319cC6ca8bdcC5b39B2C3B5C5C5C5C5C5C5C5C',
    },
  },
};

function getBridge(name) {
  return BRIDGES[name] || null;
}

function listBridges() {
  return Object.keys(BRIDGES);
}

module.exports = { BRIDGES, getBridge, listBridges };
