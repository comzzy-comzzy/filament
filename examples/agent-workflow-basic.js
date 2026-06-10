// examples/agent-workflow-basic.js
// Demonstrates an AI agent calling `stitch_identity` on a wallet, then
// `identity_confidence_report` on the result, then
// `sanction_proximity_mapper` on the highest confidence linked wallet.
//
// Run with:  npm run example:basic

const { FakeMcpClient } = require('./_fakeMcpClient');
const { toChecksumAddress } = require('../src/utils/checksum');

const SEED = '0x000000000000000000000000000000000000a11e';
const seed = toChecksumAddress(SEED);
const linked = toChecksumAddress('0x000000000000000000000000000000000000b0b');

async function main() {
  const client = new FakeMcpClient({
    nonceSeries: {
      ethereum: [1, 2, 4, 9, 16],
      base: [1, 2, 4, 9, 16],
    },
    fundingEdges: {
      [seed]: [
        { from: seed, to: linked, weight: 3 },
        { from: linked, to: seed, weight: 2 },
      ],
    },
    sanctionExposures: {
      [linked]: [
        { target: '0x0000000000000000000000000000000000000bad', hop: 1, volume: 12 },
      ],
    },
    heuristicResults: {
      [seed]: {
        noncePattern: { score: 0.62, evidence: { note: 'shape match' }, fired: true },
        eoaCluster: { score: 0.71, evidence: { reciprocity: 0.7 }, fired: true },
        sanctionProximity: { score: 0.40, evidence: { hop: 1 }, fired: true },
        contractOverlap: { score: 0.50, evidence: { jaccard: 0.4 }, fired: true },
        bridgeHop: { score: 0.30, evidence: { hops: 2 }, fired: true },
        gasBehavior: { score: 0.55, evidence: { bestCosine: 0.55 }, fired: true },
        temporalCorrelation: { score: 0.60, evidence: { topPairs: [] }, fired: true },
        deploymentDna: { score: 0.20, evidence: { collisions: 1 }, fired: true },
        entropyScorer: { score: 0.10, evidence: {}, fired: false },
      },
    },
    linkedWallets: {
      [seed]: [linked],
    },
    graphPayload: {
      [seed]: {
        nodes: [seed, linked],
        edges: [
          { from: seed, to: linked, depth: 1, weight: 3 },
          { from: linked, to: seed, depth: 1, weight: 2 },
        ],
      },
    },
  });

  const stitched = await client.callTool('stitch_identity', { wallet: seed, chains: ['ethereum', 'base'] });
  client.printResult('stitch_identity', stitched);

  const report = await client.callTool('identity_confidence_report', { wallet: seed });
  client.printResult('identity_confidence_report', report);

  const sanctions = await client.callTool('sanction_proximity_mapper', { wallet: linked, depth: 2 });
  client.printResult('sanction_proximity_mapper', sanctions);

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`example:basic failed: ${err && err.stack || err}\n`);
  process.exit(1);
});
