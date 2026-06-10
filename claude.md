# Filament — Claude Project Standards

## Project Overview
Filament is a Node.js Model Context Protocol (MCP) server that probabilistically links
EVM wallets across seven chains using pure onchain behavioral heuristics. Eleven MCP
tools are exposed, three runnable agent workflow examples are included, and a full
Jest suite verifies behavior.

## Tech Stack
- **Runtime:** Node.js >= 18
- **MCP SDK:** `@modelcontextprotocol/sdk` (v1.x)
- **RPC:** `ethers` v6
- **Config:** `dotenv`
- **Testing:** `jest`

## Directory Layout
```
src/
  server.js              # MCP protocol entry point
  heuristics/            # 9 scoring modules
  graph/                 # BFS + clustering
  rpc/                   # provider + fallback
  scoring/               # confidence engine
  tools/                 # 11 MCP tool adapters
  utils/                 # checksum, cache, rateLimit, errors
  config/                # chain + bridge registries
  data/                  # static sanctions sample
examples/                # 3 agent workflow scripts
tests/                   # Jest suites
docs/architecture.md     # design document
```

## Coding Standards
- All exports use CommonJS (`module.exports`).
- Async/await with try/catch in every handler; never throw on empty data.
- No hardcoded RPC URLs — every RPC access flows through `src/rpc/provider.js`
  reading `.env`.
- Every heuristic exports `async run(input, ctx)` returning
  `{score: 0..1, evidence, fired: boolean}`.
- Every tool exports `{name, description, inputSchema, handler}`.
- JSON-only outputs — no File, Buffer, or class instances cross the MCP boundary.
- Addresses are EIP-55 checksum validated before any RPC call.

## Common Commands
- `npm install` — install dependencies
- `npm test` — run the Jest suite
- `npm start` — start the MCP server over stdio
- `npm run example:basic` — run the basic agent workflow
- `npm run example:trace` — run the deep-trace workflow
- `npm run example:sanctions` — run the sanctions-check workflow

## Verification Shortcuts
- `npx jest <path>` — run a single suite
- `find src tests examples -type f | sort` — sanity check the layout

## Commit Style
- Imperative subject (e.g., "add nonce-pattern heuristic").
- One logical change per commit.
- End messages with `Co-Authored-By: Claude <noreply@anthropic.com>`.
