// examples/agent-workflow-sanctions-check.js
// Demonstrates an AI agent calling `eoa_cluster_graph` to expand a wallet's
// network, then running `sanction_proximity_mapper` on every node in the
// cluster, then generating a full `identity_confidence_report` with
// sanctions evidence included.
//
// Run with:  npm run example:sanctions

const { FakeMcpClient } = require('./_fakeMcpClient');
const { toChecksumAddress } = require('../src/utils/checksum');

const SEED = '0x000000000000000000000000000000000000a11e';
const seed = toChecksumAddress(SEED);
const counterparty1 = toChecksumAddress('0x000000000000000000000000000000000000c0c1');
const counterparty2 = toChecksumAddress('0x000000000000000000000000000000000000c0c2');
const sanctioned = '0x0000000000000000000000000000000000000bad';

async function main() {
  const fundingEdges = {
    [seed]: [
      { from: seed, to: counterparty1, weight: 4 },
      { from: counterparty1, to: seed, weight: 3 },
      { from: seed, to: counterparty2, weight: 1 },
    ],
  };
  const sanctionExposures = {
    [counterparty1]: [
      { target: sanctioned, hop: 1, volume: 9 },
    ],
    [counterparty2]: [],
  };
  const client = new FakeMcpClient({ fundingEdges, sanctionExposures });

  const cluster = await client.callTool('eoa_cluster_graph', {
    wallet: seed,
    chains: ['ethereum', 'arbitrum'],
    depth: 2,
  });
  client.printResult('eoa_cluster_graph', cluster);

  const members = [seed, counterparty1, counterparty2];
  const sanctionReports = [];
  for (const member of members) {
    const out = await client.callTool('sanction_proximity_mapper', { wallet: member, depth: 2 });
    sanctionReports.push({ wallet: member, output: out });
  }
  client.printResult('sanction_proximity_mapper (cluster)', sanctionReports);

  const report = await client.callTool('identity_confidence_report', {
    wallet: seed,
  });
  client.printResult('identity_confidence_report', report);

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`example:sanctions failed: ${err && err.stack || err}\n`);
  process.exit(1);
});
