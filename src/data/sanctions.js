// src/data/sanctions.js
// A small, illustrative sample of sanctioned addresses used to demonstrate
// how the `sanctionProximity` heuristic and `sanction_proximity_mapper`
// tool reason about exposure. This is NOT a complete OFAC dataset and must
// not be treated as authoritative. Operators should swap in a maintained
// feed (Chainalysis, TRM, etc.) for production use.

module.exports = {
  // The block below is intentionally short. Real deployments must replace
  // this list with a vetted, versioned sanctions feed and surface the
  // dataset version in the output of `sanction_proximity_mapper`.
  dataset: 'filament.sample.v1',
  addresses: [
    { address: '0x0000000000000000000000000000000000000bad', label: 'sample.bad.actor.1', chain: 'ethereum' },
    { address: '0x0000000000000000000000000000000000000ace', label: 'sample.bad.actor.2', chain: 'ethereum' },
    { address: '0x0000000000000000000000000000000000000fee', label: 'sample.bad.actor.3', chain: 'arbitrum' },
    { address: '0x0000000000000000000000000000000000000dad', label: 'sample.bad.actor.4', chain: 'polygon' },
    { address: '0x00000000000000000000000000000000000000ca', label: 'sample.bad.actor.5', chain: 'optimism' },
    { address: '0x00000000000000000000000000000000000000fe', label: 'sample.bad.actor.6', chain: 'base' },
    { address: '0x0000000000000000000000000000000000000b01', label: 'sample.bad.actor.7', chain: 'mantle' },
    { address: '0x0000000000000000000000000000000000000b0b', label: 'sample.bad.actor.8', chain: 'bnb' },
  ],
};
