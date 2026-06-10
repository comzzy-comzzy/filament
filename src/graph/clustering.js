// src/graph/clustering.js
// Connected-components analysis from an edge list, plus a weighted degree
// ranking. The implementation is intentionally O(N + E) with a union-find
// structure; for the wallet-graph sizes Filament sees in practice (≤ a
// few thousand nodes per query) this is comfortably fast.

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
    // Path compression.
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

function rankByDegree(edges, { weight = (e) => (e && e.weight) || 1 } = {}) {
  const degree = new Map();
  for (const edge of edges || []) {
    if (!edge) continue;
    const w = weight(edge);
    degree.set(edge.from, (degree.get(edge.from) || 0) + w);
    degree.set(edge.to, (degree.get(edge.to) || 0) + w);
  }
  return Array.from(degree.entries())
    .map(([address, score]) => ({ address, score }))
    .sort((a, b) => b.score - a.score);
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
