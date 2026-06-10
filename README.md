# Filament

A production-ready Model Context Protocol (MCP) server that probabilistically
links EVM wallets across seven chains using pure onchain behavioral
heuristics. No offchain data. No CEX info. No social profiles. Pure
cryptographic and behavioral inference only.

## Problem

Operators of meaningful onchain capital rarely keep all their assets behind
a single address. They bridge, deploy contracts, fund counterparties, and
fan out across L2s — sometimes to obscure themselves, often just because
EVM wallets are free and chains are cheap. The result: a single
underlying entity controls dozens of addresses, and the only way to
stitch them back together is to read the chain itself.

Filament provides that stitching as a set of deterministic, auditable
heuristics exposed over MCP. Every score comes with evidence; no signal
is asserted on faith.

## What Filament Does

Filament exposes **eleven** MCP tools that, together, answer a single
question: *given a wallet, which other wallets on which chains are
likely controlled by the same operator, and how confident are we?*

The tools cover identity stitching, deployment DNA matching, bridge
fund-flow tracing, gas bidding fingerprints, EOA cluster analysis,
contract interaction overlap, temporal correlation, address-entropy
scoring, sanctions exposure mapping, and an aggregate confidence report.

## How It Works (Architecture)

```
+----------+      +-----------+      +-------------+
|  Agent   | <--> |  MCP /    | <--> |  Heuristics |
| (LLM)    |      |  stdio    |      |  (9 modules)|
+----------+      +-----------+      +-------------+
                        |
                        v
                 +--------------+
                 |  Confidence  |
                 |  Engine      |
                 +--------------+
                        |
                        v
                 +--------------+
                 |  RPC layer   |  -- ethers v6 -> user-supplied RPCs
                 |  (provider + |
                 |   fallback)  |
                 +--------------+
                        |
                        v
                 +--------------+
                 |  Graph       |
                 |  (BFS + UF)  |
                 +--------------+
```

- `src/server.js` registers the eleven tool adapters and connects over
  stdio using the official MCP SDK.
- `src/rpc/provider.js` resolves per-chain `JsonRpcProvider`s from
  environment variables. Missing URLs are tolerated — the chain is just
  skipped.
- `src/rpc/fallback.js` retries transient failures up to 3 times and
  surfaces a typed `RpcError`.
- `src/heuristics/*` are pure functions: `async run(input, ctx)` returning
  `{score, evidence, fired}`.
- `src/scoring/confidenceEngine.js` aggregates the per-heuristic scores
  using declared weights and projects them onto a tier (High / Probable /
  Speculative).
- `src/graph/*` provides bounded BFS traversal and connected-component
  clustering.

## Supported Chains

| Chain    | Chain ID | Env variable   | Native symbol |
| -------- | -------- | -------------- | ------------- |
| Ethereum | 1        | `RPC_ETHEREUM` | ETH           |
| Arbitrum | 42161    | `RPC_ARBITRUM` | ETH           |
| Optimism | 10       | `RPC_OPTIMISM` | ETH           |
| Base     | 8453     | `RPC_BASE`     | ETH           |
| Mantle   | 5000     | `RPC_MANTLE`   | MNT           |
| Polygon  | 137      | `RPC_POLYGON`  | MATIC         |
| BNB      | 56       | `RPC_BNB`      | BNB           |

A chain is "supported" if it appears in `src/config/chains.js`. Whether
Filament actually queries it depends on whether the corresponding
`RPC_*` environment variable is set.

## MCP Tools Reference (all 11 tools with inputs and example outputs)

### `stitch_identity`

Primary identity stitching across chains. Runs all heuristics and returns
a confidence-scored cluster.

**Input:**

```json
{ "wallet": "0x000000000000000000000000000000000000a11e", "chains": ["ethereum", "arbitrum", "base"] }
```

**Example output (truncated):**

```json
{
  "wallet": "0x000000000000000000000000000000000000a11e",
  "chains": ["ethereum", "arbitrum", "base"],
  "depth": 2,
  "perChain": {
    "ethereum": { "skipped": false, "txCount": 137, "firstSeen": 1609459200 },
    "arbitrum": { "skipped": false, "txCount": 42, "firstSeen": 1622505600 },
    "base":    { "skipped": true, "reason": "no_rpc_configured" }
  },
  "linkedWallets": ["0x000000000000000000000000000000000000b0bb"],
  "fired": true,
  "score": 0.62,
  "tier": "Probable"
}
```

### `nonce_pattern_match`

Compares per-chain nonce sequences to score temporal fingerprint
similarity. Detects sleep cycles and burst patterns.

**Example input:**

```json
{ "wallet": "0x000000000000000000000000000000000000a11e", "chains": ["ethereum", "base"] }
```

**Example output (truncated):**

```json
{
  "wallet": "0x000000000000000000000000000000000000a11e",
  "chains": ["ethereum", "base"],
  "similarity": 0.95,
  "pattern": [
    { "chain": "ethereum", "mean": 1.0 },
    { "chain": "base", "mean": 1.0 }
  ],
  "fired": true
}
```

### `deployment_dna_scan`

Extracts constructor byte patterns, CREATE2 salts, and init-code hashes
across chains. Wallets that deploy contracts with identical DNA almost
certainly share an operator.

**Input:** `{ "wallet": "0x..." }`

### `bridge_hop_tracer`

Follows bridge interactions across Stargate, Across, Hop, and LayerZero.
Returns a directed graph of fund flows up to `depth` hops.

**Example input:**

```json
{ "wallet": "0x000000000000000000000000000000000000a11e", "depth": 2 }
```

**Example output (truncated):**

```json
{
  "wallet": "0x000000000000000000000000000000000000a11e",
  "depth": 2,
  "graph": {
    "nodes": ["0x0000...a11e", "0x0000...0a01", "0x0000...0a02"],
    "edges": [
      { "from": "0x0000...a11e", "to": "0x0000...0a01", "fromChain": "ethereum", "toChain": "arbitrum", "bridge": "stargate", "amount": 5 },
      { "from": "0x0000...0a01", "to": "0x0000...0a02", "fromChain": "arbitrum", "toChain": "base", "bridge": "hop", "amount": 4 }
    ]
  },
  "score": 0.65
}
```

### `gas_behavior_fingerprint`

Profiles gas-price bidding behaviour — fast gas preference, base-fee
hugging, tip precision. Gas behaviour is unique per operator and a
strong cross-chain signal.

### `eoa_cluster_graph`

Builds the funded/funder adjacency graph and surfaces central wallets
inside the cluster.

### `contract_interaction_overlap`

Given two wallets, scores overlap in obscure contract interactions. Long
tail is signal; Uniswap-level apps are noise.

### `temporal_activity_correlation`

Cross-correlates activity timestamps for a list of wallets. Wallets
active at identical unusual hours (e.g. 04:00 UTC) score high.

### `entropy_address_scorer`

Detects low-entropy derivation patterns in wallet-generated child
addresses — sequential suffixes, repeated bytes, vanity patterns.

### `sanction_proximity_mapper`

Maps cluster exposure to sanctioned addresses up to N hops. Returns an
exposure tree per cluster member.

### `identity_confidence_report`

Aggregates every heuristic score into a single structured report. The
final confidence tier plus the supporting evidence per linked wallet.

## Installation

```bash
git clone https://github.com/comzzy-comzzy/filament.git
cd filament
npm install
cp .env.example .env   # then fill in your RPC URLs
```

Filament targets Node.js >= 18 and has no native dependencies.

## Configuration (.env setup)

```
RPC_ETHEREUM=https://...
RPC_ARBITRUM=https://...
RPC_OPTIMISM=https://...
RPC_BASE=https://...
RPC_MANTLE=https://...
RPC_POLYGON=https://...
RPC_BNB=https://...
RATE_LIMIT_MS=200
MAX_GRAPH_DEPTH=3
CACHE_TTL_SECONDS=300
```

All `RPC_*` entries are optional; missing URLs cause the chain to be
skipped, not the server to crash. The three numeric variables control
the rate-limit interval, BFS hop cap, and in-memory cache TTL.

## Running the Server

```bash
npm start
```

Filament speaks MCP over stdio, so any MCP-compatible client can connect
to it directly:

```json
{
  "mcpServers": {
    "filament": {
      "command": "node",
      "args": ["/absolute/path/to/filament/src/server.js"]
    }
  }
}
```

## Running Agent Workflows

Three runnable examples ship in `examples/`:

```bash
npm run example:basic       # stitch + report + sanctions
npm run example:trace       # bridge trace + temporal + nonce match
npm run example:sanctions   # cluster + per-member sanctions + final report
```

Each example uses an in-process `FakeMcpClient` so it runs without an
MCP transport.

## Running Tests

```bash
npm test
```

The Jest suite covers address validation, cache TTL, rate-limit pacing,
graph depth cap, clustering, confidence engine aggregation, all nine
heuristics (mocked), and tool schema validation.

## Project Structure

```
filament/
├── src/
│   ├── server.js              # MCP protocol entry point
│   ├── heuristics/            # 9 scoring modules
│   ├── graph/                 # BFS + clustering
│   ├── rpc/                   # provider + fallback
│   ├── scoring/               # confidence engine
│   ├── tools/                 # 11 MCP tool adapters
│   ├── utils/                 # checksum, cache, rateLimit, errors
│   ├── config/                # chain + bridge registries
│   └── data/                  # static sanctions sample
├── examples/                  # 3 agent workflow scripts
├── tests/                     # Jest suites
├── docs/architecture.md       # design document
├── .env.example
├── package.json
└── README.md
```

## Technical Design Decisions

- **Pure onchain signals only.** Filament never consults CEX KYC, social
  profiles, or any offchain API. Every heuristic is reproducible from
  chain data alone.
- **Custom BFS instead of a graph library.** Wallet graphs are small
  (≤ a few thousand nodes) and the visit-order is part of the contract;
  pulling in a heavyweight library is not worth it.
- **Per-call TTL cache, not a shared store.** Cache keys are derived
  from `(wallet, chain, depth, heuristic)` and expired in-process; no
  disk persistence and no cross-instance invalidation.
- **Serial rate limiter.** The RPC hot path is sequential async/await,
  so a queue-based gate is overkill. We enforce `RATE_LIMIT_MS` between
  consecutive outbound calls and tolerate concurrent callers.
- **Weighted score + tier.** Heuristic scores in `[0, 1]` are combined
  with declared weights summing to 1.0, then projected onto High /
  Probable / Speculative.
- **Typed errors.** `InvalidAddressError`, `RpcError`, `SchemaError`,
  `RateLimitError` all derive from `FilamentError` so callers can
  pattern-match on `err.name`.
- **JSON-only across the MCP boundary.** Buffers, classes, and streams
  are never serialised to the client.

## License

MIT. See `LICENSE` (not yet committed; planned for the next release).
