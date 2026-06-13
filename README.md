# Filament

A production-ready Model Context Protocol (MCP) server that probabilistically
links EVM wallets across seven chains using pure onchain behavioral
heuristics. No offchain data. No CEX info. No social profiles. Pure
cryptographic and behavioral inference only.

## Hosted Public Instance

A public Streamable HTTP endpoint is live — no install, no RPC keys, no `.env`:

**Claude / Streamable HTTP URL:** `https://filament-production-84b7.up.railway.app/mcp`

Drop this into Claude or any MCP-compatible client that supports remote
Streamable HTTP servers:

```json
{
  "mcpServers": {
    "filament": {
      "type": "http",
      "url": "https://filament-production-84b7.up.railway.app/mcp"
    }
  }
}
```

> ⚠️ This is a shared instance. Be polite — no tight loops, no bulk
> cluster sweeps. For heavy / production use, run your own (see
> [Running the Server](#running-the-server) below).

### Quick health check

```bash
# 1. Confirm the server is reachable
curl https://filament-production-84b7.up.railway.app/health
# → {"status":"ok","transport":["stdio","streamable-http","sse"],"tools":11,...}

# 2. Modern MCP clients POST JSON-RPC to /mcp.
curl -sS -X POST https://filament-production-84b7.up.railway.app/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### Legacy SSE compatibility

`/sse` is retained only for older MCP clients that do not support
Streamable HTTP. Do not use it for Claude's remote connector.

Legacy endpoint:

```
https://filament-production-84b7.up.railway.app/sse
```

SSE clients open `GET /sse`, receive a `sessionId`, then send JSON-RPC
to `POST /messages?sessionId=<id>`.

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
| (LLM)    |      |  stdio /  |      |  (9 modules)|
|          |      |  SSE      |      |             |
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
  either transport. **stdio** is the default (no env var needed);
  **SSE** is enabled with `MCP_TRANSPORT=sse` and serves on `PORT`
  (default `3000`) with `GET /sse`, `POST /messages`, and `GET /health`.
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
    "ethereum": { "ok": true, "depth": 2 },
    "arbitrum": { "ok": true, "depth": 2 },
    "base":     { "skipped": true, "reason": "no_rpc_configured" }
  },
  "heuristicScores": {
    "noncePattern":        { "score": 0.62, "fired": true,  "evidence": { "similarity": 0.62 } },
    "deploymentDna":       { "score": 0.20, "fired": true,  "evidence": { "collisions": 1 } },
    "bridgeHop":           { "score": 0.65, "fired": true,  "evidence": { "hops": 4 } },
    "gasBehavior":         { "score": 0.55, "fired": true,  "evidence": { "bestCosine": 0.55 } },
    "eoaCluster":          { "score": 0.71, "fired": true,  "evidence": { "reciprocity": 0.7 } },
    "contractOverlap":     { "score": 0.00, "fired": false, "evidence": { "reason": "pairwise_heuristic", "tool": "contract_interaction_overlap" } },
    "temporalCorrelation": { "score": 0.60, "fired": true,  "evidence": { "topPairs": [] } },
    "entropyScorer":       { "score": 0.10, "fired": false, "evidence": { "reason": "no_data" } },
    "sanctionProximity":   { "score": 0.40, "fired": true,  "evidence": { "hop": 1 } }
  },
  "score": 0.46,
  "tier": "Probable",
  "breakdown": [
    { "heuristic": "noncePattern",        "weight": 0.10, "score": 0.62, "contribution": 0.062, "fired": true },
    { "heuristic": "deploymentDna",       "weight": 0.15, "score": 0.20, "contribution": 0.030, "fired": true }
  ],
  "linkedWallets": ["0x000000000000000000000000000000000000b0bb"],
  "graphPayload": { "nodes": ["0x…a11e", "0x…b0bb"], "edges": [] },
  "weights": { "noncePattern": 0.10, "deploymentDna": 0.15, "bridgeHop": 0.10, "gasBehavior": 0.10, "eoaCluster": 0.15, "contractOverlap": 0.15, "temporalCorrelation": 0.10, "entropyScorer": 0.05, "sanctionProximity": 0.10 }
}
```

The pairwise `contract_interaction_overlap` heuristic is intentionally
not invoked from this tool (it requires a second wallet); callers
needing it should use the dedicated `contract_interaction_overlap`
tool.

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
RPC_TIMEOUT_MS=10000
MAX_GRAPH_DEPTH=3
CACHE_TTL_SECONDS=300
HISTORY_BLOCKS=50000
MAX_LOG_BLOCK_RANGE=50000
MAX_LOGS_PER_CHAIN=500
MAX_EDGES=250
MAX_BLOCK_LOOKUPS=25
MAX_GAS_SAMPLES=5
MCP_TRANSPORT=sse   # "stdio" (default) or "sse"
PORT=3000           # only used in SSE mode
```

All `RPC_*` entries are optional; missing URLs cause the chain to be
skipped, not the server to crash. The numeric variables control
rate limiting, per-RPC timeout, graph depth, cache TTL, and the amount of chain history
queried for each hosted tool call. Raise the history and result caps on
dedicated deep-scan deployments; keep the defaults for Claude/Railway
connectors that need to return quickly. The two transport variables
select stdio vs. HTTP mode and the HTTP port.

## Running the Server

Filament supports two transports, selected by the `MCP_TRANSPORT` env
var. **stdio is the default** — no config required.

| Mode     | Command               | Endpoint                                                        | Use case                       |
| -------- | --------------------- | --------------------------------------------------------------- | ------------------------------ |
| `stdio`  | `npm start`           | local child process                                             | Local agent, Cursor, IDE       |
| `sse`    | `npm run start:sse`   | `http://localhost:3000/mcp` (legacy `/sse` also available)      | Claude / remote / hosted use   |

### Option A — stdio (local child process)

```bash
npm start                  # or: npm run start:stdio
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

### Option B — HTTP (local)

```bash
npm run start:sse          # MCP_TRANSPORT=sse PORT=3000 node src/server.js
```

This starts an Express server on `PORT` (default `3000`) exposing:

| Method | Path                         | Purpose                                     |
| ------ | ---------------------------- | ------------------------------------------- |
| `POST` | `/mcp`                       | Streamable HTTP MCP endpoint                |
| `GET`  | `/sse`                       | Open an MCP SSE session (returns sessionId) |
| `POST` | `/messages?sessionId=…`      | Send a JSON-RPC message to that session     |
| `GET`  | `/health`                    | Liveness + tool count                       |
| `*`    | `*`                          | CORS is enabled on every endpoint           |

On startup the server logs:

```
Filament MCP server running on http://localhost:3000/mcp
Legacy SSE endpoint available at http://localhost:3000/sse
```

**Connect from an MCP client:**

```json
{
  "mcpServers": {
    "filament": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Some older clients still require the legacy SSE endpoint:

```json
{
  "mcpServers": {
    "filament": {
      "type": "sse",
      "url": "http://localhost:3000/sse"
    }
  }
}
```

**Smoke-test the endpoints manually:**

```bash
# 1. Liveness
curl http://localhost:3000/health
# → {"status":"ok","transport":["stdio","streamable-http","sse"],"tools":11,...}

# 2. Streamable HTTP tools list
curl -sS -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# 3. Legacy SSE stream
curl -N http://localhost:3000/sse
# → event: endpoint
#   data: /messages?sessionId=8e0c...
```

### Option C — Use the hosted public instance

Skip the install entirely and point any MCP client at:

```
https://filament-production-84b7.up.railway.app/mcp
```

```json
{
  "mcpServers": {
    "filament": {
      "type": "http",
      "url": "https://filament-production-84b7.up.railway.app/mcp"
    }
  }
}
```

This is the same server, hosted on Railway, with the operator's own
RPC URLs already wired in. Be polite — it's a shared instance.

### Notes for deployers

- `MCP_TRANSPORT=sse` switches the server to HTTP mode. Anything else
  (or unset) keeps stdio mode active.
- `PORT` is only consumed in HTTP mode and defaults to `3000`.
- `npm start` and `npm run start:stdio` are aliases for the same
  stdio command — pick whichever fits your tooling.
- `/mcp` is the preferred remote endpoint. `/sse` and `/messages` remain
  for older MCP clients that only support HTTP+SSE.
- CORS is wide-open (`*`) on every route. Tighten it for production
  by replacing the bare `app.use(cors())` call in `src/server.js`.

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
