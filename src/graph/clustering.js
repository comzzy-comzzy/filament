// src/graph/clustering.js
// Connected-components analysis from an edge list, plus a weighted degree
// ranking. The implementation is intentionally O(N + E) with a union-find
// structure; for the wallet-graph sizes Filament sees in practice (≤ a
// few thousand nodes per query) this is comfortably fast.
//
// The module is structural: it does NOT validate or normalise addresses.
// Edges are expected to come from `src/graph/traversal.js`, which already
// checksum-normalises its `from`/`to` fields. Validation at this layer
// would be wasted work and would also make the module harder to unit-test
// in isolation.
//
// Self-loop convention: an edge where `from === to` contributes TWICE to
// the weighted degree of that node (once for the source endpoint, once for
// the target endpoint). This matches the standard undirected-graph
// convention and keeps the math symmetric regardless of how the loop is
// recorded in the edge list.

class UnionFind {
  constructor() {
    this.parent = new Map();
    this.rank = new Map();
  }

  add(x) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
  }

  find(x) {
    this.add(x);
    let root = x;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root);
    }
    // Path compression: flatten every visited node directly to the root so
    // future `find` calls on the same set are O(1) amortised.
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur);
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra);
    const rankB = this.rank.get(rb);
    if (rankA < rankB) {
      this.parent.set(ra, rb);
    } else if (rankA > rankB) {
      this.parent.set(rb, ra);
    } else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }

  size() {
    return this.parent.size;
  }
}

function computeComponents(edges) {
  const uf = new UnionFind();
  for (const edge of edges || []) {
    if (!edge || !edge.from || !edge.to) continue;
    uf.add(edge.from);
    uf.add(edge.to);
    uf.union(edge.from, edge.to);
  }
  const groups = new Map();
  for (const node of uf.parent.keys()) {
    const root = uf.find(node);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(node);
  }
  return Array.from(groups.values()).map((members) => members.slice().sort());
}

const DEFAULT_WEIGHT = (e) => {
  if (!e) return 1;
  const w = e.weight;
  return typeof w === 'number' ? w : 1;
};

function rankByDegree(edges, { weight = DEFAULT_WEIGHT } = {}) {
  const degree = new Map();
  for (const edge of edges || []) {
    if (!edge || !edge.from || !edge.to) continue;
    const w = Number(weight(edge));
    // NaN / +Infinity / -Infinity carry no meaningful magnitude; skip them
    // rather than poisoning the degree sum.
    if (!Number.isFinite(w)) continue;
    if (w === 0) continue; // zero-weight edges carry no information
    degree.set(edge.from, (degree.get(edge.from) || 0) + w);
    degree.set(edge.to, (degree.get(edge.to) || 0) + w);
  }
  return Array.from(degree.entries())
    .map(([address, score]) => ({ address, score }))
    // Primary sort: highest weighted degree first.
    // Secondary sort: ascending address, so ties have a stable,
    // deterministic order across runs (important for snapshot tests
    // and downstream consumers that join on ranking position).
    .sort((a, b) => (b.score - a.score) || a.address.localeCompare(b.address));
}

function cluster(edges) {
  const components = computeComponents(edges);
  const ranking = rankByDegree(edges);
  return { components, ranking };
}

module.exports = {
  UnionFind,
  computeComponents,
  rankByDegree,
  cluster,
};
