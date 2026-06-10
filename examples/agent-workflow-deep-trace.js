// examples/agent-workflow-deep-trace.js
// Demonstrates an AI agent calling `bridge_hop_tracer` at depth 3,
// extracting destination wallets from the graph, then running
// `temporal_activity_correlation` across all discovered wallets, then
// `nonce_pattern_match` on the top correlated pair.
//
// Run with:  npm run example:trace

const { FakeMcpClient } = require('./_fakeMcpClient');
const { toChecksumAddress } = require('../src/utils/checksum');

const SEED = '0x000000000000000000000000000000000000a11e';
const seed = toChecksumAddress(SEED);
const w1 = toChecksumAddress('0x0000000000000000000000000000000000000a01');
const w2 = toChecksumAddress('0x0000000000000000000000000000000000000a02');
const w3 = toChecksumAddress('0x0000000000000000000000000000000000000a03');

async function main() {
  const bridgeEdges = {
    [seed]: [
      { from: seed, to: w1, fromChain: 'ethereum', toChain: 'arbitrum', bridge: 'stargate', amount: 5 },
      { from: w1, to: w2, fromChain: 'arbitrum', toChain: 'base', bridge: 'hop', amount: 4 },
      { from: w2, to: w3, fromChain: 'base', toChain: 'optimism', bridge: 'across', amount: 3 },
    ],
  };
  const client = new FakeMcpClient({ bridgeEdges });

  const trace = await client.callTool('bridge_hop_tracer', { wallet: seed, depth: 3 });
  client.printResult('bridge_hop_tracer', trace);

  const discovered = Array.from(
    new Set(
      (trace.graph.edges || []).flatMap((e) => [e.from, e.to]).concat([seed]),
    ),
  );

  const activityTimestamps = {};
  for (const w of discovered) {
    activityTimestamps[w] = [];
    for (let day = 0; day < 7; day += 1) {
      // Cluster at 04:00 UTC to trigger the timezone hypothesis.
      activityTimestamps[w].push(Date.UTC(2025, 5, day + 1, 4, 0, 0) / 1000);
    }
  }
  const temporalClient = new FakeMcpClient({ activityTimestamps });
  const temporal = await temporalClient.callTool('temporal_activity_correlation', {
    wallets: discovered,
    chains: ['ethereum', 'arbitrum', 'base', 'optimism'],
  });
  temporalClient.printResult('temporal_activity_correlation', temporal);

  if (temporal.topPairs && temporal.topPairs.length > 0) {
    const top = temporal.topPairs[0];
    const nonceClient = new FakeMcpClient({
      nonceSeries: {
        ethereum: [1, 2, 3, 5, 8, 13],
        base: [1, 2, 3, 5, 8, 13],
      },
    });
    const nonce = await nonceClient.callTool('nonce_pattern_match', { wallet: top.a, chains: ['ethereum', 'base'] });
    nonceClient.printResult('nonce_pattern_match', nonce);
  }

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`example:trace failed: ${err && err.stack || err}\n`);
  process.exit(1);
});
