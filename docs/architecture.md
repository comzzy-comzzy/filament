# Filament — Architecture

This document explains the design rationale behind Filament's heuristics,
scoring, graph traversal, RPC management, and caching. It is intended
for reviewers and operators who need to understand *why* a given
heuristic behaves the way it does.

## Heuristic design rationale

The nine heuristics are split into two camps: **deterministic** (no RPC
required to score) and **RPC-driven** (need chain state). The split lets
Filament degrade gracefully — deterministic heuristics always run, RPC
heuristics are skipped if no provider is configured for the chain.

| Module                  | Inputs                                 | Output range | Why it works |
| ----------------------- | -------------------------------------- | ------------ | ------------ |
| `noncePattern`          | Per-chain timestamp series             | `[0, 1]`     | Schedulers and humans produce repeatable timing shapes; identical gap distributions across chains are unlikely to be coincidence. |
| `deploymentDna`         | Array of `(chain, bytecode)`           | `[0, 1]`     | Identical init code from the same deployer is a strong shared-operator signal. The DNA hash is the keccak256 of the lowercase hex body. |
| `bridgeHopTracer`       | Edge list with `fromChain/toChain/amount/bridge` | `[0, 1]` | Breadth across chains, total volume, and diversity of bridge protocols together indicate operational complexity — single-actor use tends to look very specific. |
| `gasBehavior`           | Per-chain `(baseFee, tip, gasLimit)` samples | `[0, 1]` | Operators have idiosyncratic bidding habits (fast/slow, tip precision, gas-limit headroom). Cosine similarity catches the shape even when absolute values differ by chain. |
| `eoaClusterGraph`       | Funded/funder edges                    | `[0, 1]`     | Reciprocity (A funds B **and** B funds A) is much rarer among unrelated addresses than among an operator's own cluster. |
| `contractOverlap`       | Per-wallet interaction lists           | `[0, 1]`     | Mass-market apps (Uniswap, Aave) are noise — too many wallets hit them. The long tail (obscure contracts) carries real signal. Jaccard + obscure boost. |
| `temporalCorrelation`   | Per-wallet timestamp arrays            | `[0, 1]`     | Cross-correlation on hour-of-day buckets. Identical off-hours activity (e.g. 04:00 UTC) is suspicious. |
| `entropyScorer`         | Child addresses                        | `[0, 1]`     | HD wallets are uniformly random. Vanity or sequential generators produce measurable entropy deficits and detectable patterns. |
| `sanctionProximity`     | List of exposures `(target, hop, volume)` | `[0, 1]` | Direct exposure to a sanctioned address is high-signal; multi-hop exposure decays. Volume modulates the contribution. |

## Confidence scoring algorithm

The confidence engine in `src/scoring/confidenceEngine.js` aggregates
per-heuristic scores with declared weights. Weights default to:

| Heuristic              | Weight |
| ---------------------- | -----: |
| `noncePattern`         |   0.10 |
| `deploymentDna`        |   0.15 |
| `bridgeHop`            |   0.10 |
| `gasBehavior`          |   0.10 |
| `eoaCluster`           |   0.15 |
| `contractOverlap`      |   0.15 |
| `temporalCorrelation`  |   0.10 |
| `entropyScorer`        |   0.05 |
| `sanctionProximity`    |   0.10 |

Tiers:

- `score >= 0.70` → `High`
- `score >= 0.45` → `Probable`
- otherwise → `Speculative`

If a caller passes weights that do not sum to 1.0, the engine silently
renormalises them — the alternative (throwing) would make downstream
tools harder to compose.

## Graph traversal strategy

`src/graph/traversal.js` implements a bounded BFS over an adjacency
list. The walk never revisits a node (a `Set` tracks visited addresses),
and `maxDepth` is a hard cap supplied by the `MAX_GRAPH_DEPTH`
environment variable. Output is the canonical `{nodes, edges}` payload
that downstream tools (and `identity_confidence_report`) consume.

`src/graph/clustering.js` provides a union-find connected-components
implementation plus a weighted-degree ranking. The combination is
O(N + E) and comfortably handles wallet graphs of a few thousand
nodes per query.

## RPC management and fallback design

`src/rpc/provider.js` resolves an `ethers` v6 `JsonRpcProvider` per
chain from the `RPC_*` environment variable. Missing URLs are tolerated:
`getProvider('ethereum')` returns `null` when `RPC_ETHEREUM` is unset, and
heuristics are responsible for skipping the chain gracefully.

`src/rpc/fallback.js` wraps an async function with bounded retries:
**3 attempts, 200 ms linear backoff**. The retry policy is conservative
because each attempt costs real RPC credits. Hard validation errors
(`INVALID_ARGUMENT`, `UNSUPPORTED_OPERATION`) are *not* retried; the
final throw is a typed `RpcError` carrying the original `cause`.

A serial `RateLimiter` in `src/utils/rateLimit.js` enforces a minimum
`RATE_LIMIT_MS` between consecutive outbound calls. Concurrent callers
serialise behind a single in-flight promise chain.

## Caching strategy

`src/utils/cache.js` is an in-memory TTL cache. Keys are read against
the current wall clock on every `get` and expired lazily. `stats()`
exposes `hits`, `misses`, `sets`, `evictions`, and `size` for
observability. The cache is process-local — no disk, no cross-instance
invalidation. Cache keys are derived from `(wallet, chain, depth,
heuristic)`, so a `CACHE_TTL_SECONDS` value of `300` covers the typical
"AI agent revisits the same query a few seconds later" use case without
stale results on long-running agents.

## Known limitations and false positive risks

Filament's heuristics are deliberately conservative, but no
behavioural signal is perfect. Operators should be aware of the
following failure modes:

1. **Coincidental timing overlap.** Two unrelated traders in the same
   timezone can produce overlapping nonce gap distributions. The
   `noncePattern` heuristic scores *shape*, not absolute values, so a
   busy period for one wallet can look like the busy period of another.
   The confidence engine partially absorbs this by weighting the
   signal at only 0.10.
2. **Shared infra (e.g. multisig, exchange hot wallets).** When two
   addresses share custody, every heuristic fires. `identity_confidence_report`
   will report `High` confidence, but the answer is correct only if
   "shared custody" is what the operator actually wanted to detect.
   Filament cannot tell a multisig from a single EOA; that requires
   bytecode-level inspection beyond the spec.
3. **Vanity-only heuristics.** `entropyScorer` flags low-entropy child
   addresses, but legitimate projects routinely use vanity deployers.
   The score should be treated as a hint, not a verdict.
4. **Sanctions list staleness.** `src/data/sanctions.js` is an
   illustrative sample, not a maintained feed. Production deployments
   must replace it with a vetted dataset (Chainalysis, TRM, OFAC list
   snapshot) and surface the dataset version in every sanctions result
   (`evidence.datasetVersion` already exposes this).
5. **RPC quality variance.** Filament tolerates a single missing `RPC_*`
   but a flaky RPC can produce *partial* graphs. Tools that report
   `clusterSize: 0` should be re-run on a different RPC if the chain is
   important to the investigation.
6. **Heuristic correlation.** The nine heuristics are not
   statistically independent (e.g. an operator who is active at
   04:00 UTC is also likely to have a low-entropy deployer). The
   weighted sum therefore *over-states* confidence on correlated
   signals. A more conservative engine would account for this; it is
   out of scope for v0.1.
7. **No offchain signal by design.** Filament does not look up ENS,
   social profiles, or CEX KYC. These would be much stronger signals
   but are explicitly out of scope; the project is "pure onchain
   behavioral inference only".
