# Filament — CyOps Build Prompt

Build a production-ready Model Context Protocol (MCP) server called **Filament** — a cross-chain wallet identity stitching engine that uses pure onchain behavioral heuristics to probabilistically link wallets controlled by the same operator across multiple EVM chains. No offchain data. No CEX info. No social profiles. Pure cryptographic and behavioral inference only.

---

## Project Structure

```
filament/
├── src/
│   ├── server.js              # MCP protocol entry point
│   ├── heuristics/
│   │   ├── noncePattern.js
│   │   ├── deploymentDna.js
│   │   ├── bridgeHopTracer.js
│   │   ├── gasBehavior.js
│   │   ├── eoaClusterGraph.js
│   │   ├── contractOverlap.js
│   │   ├── temporalCorrelation.js
│   │   ├── entropyScorer.js
│   │   └── sanctionProximity.js
│   ├── graph/
│   │   ├── traversal.js
│   │   └── clustering.js
│   ├── rpc/
│   │   ├── provider.js
│   │   └── fallback.js
│   ├── scoring/
│   │   └── confidenceEngine.js
│   └── tools/
│       ├── stitchIdentity.js
│       ├── noncePatternMatch.js
│       ├── deploymentDnaScan.js
│       ├── bridgeHopTracer.js
│       ├── gasBehaviorFingerprint.js
│       ├── eoaClusterGraph.js
│       ├── contractInteractionOverlap.js
│       ├── temporalActivityCorrelation.js
│       ├── entropyAddressScorer.js
│       ├── sanctionProximityMapper.js
│       └── identityConfidenceReport.js
├── examples/
│   ├── agent-workflow-basic.js
│   ├── agent-workflow-deep-trace.js
│   └── agent-workflow-sanctions-check.js
├── tests/
│   ├── heuristics.test.js
│   ├── scoring.test.js
│   └── tools.test.js
├── docs/
│   └── architecture.md
├── .env.example
├── package.json
└── README.md
```

---

## Tech Stack

- **Runtime:** Node.js
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **RPC:** `ethers.js` v6
- **Graph engine:** Custom adjacency list implementation
- **Testing:** Jest
- **Chain support:** Ethereum, Arbitrum, Optimism, Base, Mantle, Polygon, BNB Chain
- **Transport:** stdio (standard MCP transport)

---

## Environment Variables

```
RPC_ETHEREUM=
RPC_ARBITRUM=
RPC_OPTIMISM=
RPC_BASE=
RPC_MANTLE=
RPC_POLYGON=
RPC_BNB=
RATE_LIMIT_MS=200
MAX_GRAPH_DEPTH=3
CACHE_TTL_SECONDS=300
```

---

## MCP Tools to Implement

Implement all 11 tools fully. Each tool must be registered in the MCP server with proper name, description, and inputSchema.

---

### Tool 1: `stitch_identity`
**Description:** Primary identity stitching tool. Runs all heuristics across specified chains and returns a confidence-scored identity cluster.

**Input:**
```json
{
  "wallet": "0x...",
  "chains": ["ethereum", "arbitrum", "mantle"]
}
```

**Returns:** Confidence-scored cluster of linked wallets with supporting evidence per link, heuristics that fired, and overall cluster confidence tier (High / Probable / Speculative).

---

### Tool 2: `nonce_pattern_match`
**Description:** Compares transaction nonce sequencing and activity timing gaps across chains. Detects sleep cycles, burst patterns, weekend gaps. Returns temporal fingerprint similarity score between wallets.

**Input:**
```json
{
  "wallet": "0x...",
  "chains": ["ethereum", "base"]
}
```

**Returns:** Temporal fingerprint object, similarity score 0–1, pattern description.

---

### Tool 3: `deployment_dna_scan`
**Description:** Extracts constructor bytecode patterns, CREATE2 salt values, deployer nonce sequences, and init code hashes across chains. Identifies wallets deploying contracts with identical or near-identical DNA.

**Input:**
```json
{
  "wallet": "0x..."
}
```

**Returns:** Bytecode fingerprint hash, matched wallets on other chains, similarity score, deployment timeline.

---

### Tool 4: `bridge_hop_tracer`
**Description:** Follows bridge interactions across Stargate, Across, Hop, and LayerZero. Maps cross-chain capital movement at configurable depth. Returns directed graph of fund flows.

**Input:**
```json
{
  "wallet": "0x...",
  "depth": 2
}
```

**Returns:** Directed graph object with nodes (wallets), edges (bridge transactions), amounts, timestamps, bridge protocol used.

---

### Tool 5: `gas_behavior_fingerprint`
**Description:** Profiles gas price bidding behavior across chains — fast gas preference, base fee hugging, tip precision, gas limit patterns. Gas behavior is unique per operator. Returns behavioral gas signature.

**Input:**
```json
{
  "wallet": "0x...",
  "chains": ["ethereum", "optimism"]
}
```

**Returns:** Gas signature object, bidding style classification, cross-chain similarity score.

---

### Tool 6: `eoa_cluster_graph`
**Description:** Builds full social graph of wallets this address has directly funded, been funded by, or co-signed transactions with across all specified chains. Returns adjacency list with edge weights.

**Input:**
```json
{
  "wallet": "0x...",
  "chains": ["ethereum", "arbitrum", "mantle"],
  "depth": 2
}
```

**Returns:** Adjacency list, edge weights by transaction count and volume, cluster size, central wallet candidates.

---

### Tool 7: `contract_interaction_overlap`
**Description:** Given two wallets, scores how many of the same obscure contracts they have interacted with, in what order, and within what time windows. High obscure overlap is strong signal for shared operator.

**Input:**
```json
{
  "wallet_a": "0x...",
  "wallet_b": "0x..."
}
```

**Returns:** Overlap score 0–1, list of shared contracts, interaction order similarity, time window proximity scores.

---

### Tool 8: `temporal_activity_correlation`
**Description:** Takes a list of wallets and runs cross-correlation on their activity timestamps across chains. Returns correlation matrix — wallets active at identical unusual hours score high.

**Input:**
```json
{
  "wallets": ["0x...", "0x...", "0x..."],
  "chains": ["ethereum", "base"]
}
```

**Returns:** Correlation matrix, highest correlated pairs, activity heatmap data, timezone inference.

---

### Tool 9: `entropy_address_scorer`
**Description:** Analyzes wallet-generated child addresses for low-entropy patterns — sequential suffixes, vanity patterns, repeated byte segments — suggesting shared key derivation strategy.

**Input:**
```json
{
  "wallet": "0x..."
}
```

**Returns:** Entropy score, detected patterns, list of flagged child addresses, derivation strategy hypothesis.

---

### Tool 10: `sanction_proximity_mapper`
**Description:** Maps the wallet's identity cluster exposure to sanctioned addresses at configurable graph depth. Returns structured exposure tree per cluster member — not just direct interaction but second and third degree.

**Input:**
```json
{
  "wallet": "0x...",
  "depth": 3
}
```

**Returns:** Exposure tree, proximity score per sanctioned address, hop count, interaction type, cluster member breakdown.

---

### Tool 11: `identity_confidence_report`
**Description:** Aggregates all heuristic scores into a single structured report. Returns confidence tiers, supporting evidence per linked wallet, heuristic breakdown, and a graph payload ready for visualization.

**Input:**
```json
{
  "wallet": "0x..."
}
```

**Returns:** Full structured report — confidence tier, linked wallets list, per-heuristic scores, evidence summary, graph payload.

---

## Engineering Requirements

- Every tool must have **full error handling** — invalid address, RPC failure, empty response, rate limit hit
- Every RPC call must go through `/rpc/provider.js` with fallback to `/rpc/fallback.js`
- Implement **in-memory caching** with TTL for expensive graph queries
- All wallet addresses must be **checksum validated** before processing
- Rate limiting between RPC calls using `RATE_LIMIT_MS` env variable
- No hardcoded RPC URLs — everything from `.env`
- All functions must be **async/await** with proper try/catch
- Graph traversal must respect `MAX_GRAPH_DEPTH` to prevent infinite loops

---

## Agent Workflow Examples

Build three complete working agent workflow scripts in `/examples`:

### `agent-workflow-basic.js`
Demonstrates an AI agent calling `stitch_identity` on a wallet, then calling `identity_confidence_report` on the result, then calling `sanction_proximity_mapper` on the highest confidence linked wallet.

### `agent-workflow-deep-trace.js`
Demonstrates an AI agent calling `bridge_hop_tracer` at depth 3, extracting destination wallets from the graph, then running `temporal_activity_correlation` across all discovered wallets, then `nonce_pattern_match` on the top correlated pair.

### `agent-workflow-sanctions-check.js`
Demonstrates an AI agent calling `eoa_cluster_graph` to expand a wallet's network, then running `sanction_proximity_mapper` on every node in the cluster, then generating a full `identity_confidence_report` with sanctions evidence included.

---

## Tests

Write Jest tests covering:
- Address checksum validation
- Heuristic scoring functions with mock RPC data
- Confidence engine aggregation logic
- Graph traversal depth limiting
- Cache TTL behavior

---

## README Requirements

Structure the README exactly as follows:

```
# Filament

## Problem
## What Filament Does
## How It Works (Architecture)
## Supported Chains
## MCP Tools Reference (all 11 tools with inputs and example outputs)
## Installation
## Configuration (.env setup)
## Running the Server
## Running Agent Workflows
## Running Tests
## Project Structure
## Technical Design Decisions
## License
```

---

## docs/architecture.md

Write a technical architecture document covering:
- Heuristic design rationale for each module
- Confidence scoring algorithm explanation
- Graph traversal strategy
- RPC management and fallback design
- Caching strategy
- Known limitations and false positive risks

---

## Final Checklist Before Completing

Before finishing, verify every item below is done:

- [ ] All 11 MCP tools registered and functional
- [ ] All tools have inputSchema defined
- [ ] All heuristic modules exist as separate files
- [ ] RPC provider and fallback implemented
- [ ] In-memory cache implemented
- [ ] Rate limiting implemented
- [ ] All 3 agent workflow examples complete and runnable
- [ ] All Jest tests written
- [ ] README covers all 14 sections
- [ ] architecture.md complete
- [ ] .env.example present with all variables
- [ ] No hardcoded values anywhere

---

Build this completely. Do not skip any file. Do not leave placeholder comments. Every file must contain real, working implementation code.
