// tests/graph/clustering.test.js
const {
  UnionFind,
  computeComponents,
  rankByDegree,
  cluster,
} = require('../../src/graph/clustering');

function w(n) {
  return '0x' + n.toString(16).padStart(40, '0');
}

describe('graph/clustering — components and ranking', () => {
  test('identifies two disjoint components', () => {
    const edges = [
      { from: w(1), to: w(2) },
      { from: w(2), to: w(3) },
      { from: w(10), to: w(11) },
    ];
    const comps = computeComponents(edges);
    expect(comps).toHaveLength(2);
    const sizes = comps.map((c) => c.length).sort();
    expect(sizes).toEqual([2, 3]);
  });

  test('rankByDegree orders nodes by weighted degree', () => {
    const edges = [
      { from: w(1), to: w(2), weight: 5 },
      { from: w(1), to: w(3), weight: 2 },
      { from: w(2), to: w(3), weight: 1 },
    ];
    const ranking = rankByDegree(edges);
    expect(ranking[0].address).toBe(w(1));
    expect(ranking[0].score).toBe(7);
  });

  test('cluster returns both components and ranking', () => {
    const edges = [
      { from: w(1), to: w(2), weight: 1 },
      { from: w(2), to: w(3), weight: 1 },
    ];
    const out = cluster(edges);
    expect(out.components).toHaveLength(1);
    expect(out.ranking).toHaveLength(3);
  });

  test('handles empty edge list', () => {
    expect(computeComponents([])).toEqual([]);
    expect(rankByDegree([])).toEqual([]);
    expect(cluster([])).toEqual({ components: [], ranking: [] });
  });

  test('handles null/undefined input gracefully', () => {
    expect(computeComponents(null)).toEqual([]);
    expect(computeComponents(undefined)).toEqual([]);
    expect(rankByDegree(null)).toEqual([]);
    expect(cluster(undefined)).toEqual({ components: [], ranking: [] });
  });

  test('single edge produces a single component with two nodes', () => {
    const edges = [{ from: w(7), to: w(8), weight: 1 }];
    const comps = computeComponents(edges);
    expect(comps).toHaveLength(1);
    expect(comps[0]).toEqual([w(7), w(8)]);
    const ranking = rankByDegree(edges);
    expect(ranking).toHaveLength(2);
    expect(ranking.every((r) => r.score === 1)).toBe(true);
  });

  test('three disconnected pairs produce three components', () => {
    const edges = [
      { from: w(1), to: w(2) },
      { from: w(3), to: w(4) },
      { from: w(5), to: w(6) },
    ];
    const comps = computeComponents(edges);
    expect(comps).toHaveLength(3);
    expect(comps.every((c) => c.length === 2)).toBe(true);
  });

  test('triangle collapses to a single component of three nodes', () => {
    const edges = [
      { from: w(1), to: w(2) },
      { from: w(2), to: w(3) },
      { from: w(3), to: w(1) },
    ];
    const comps = computeComponents(edges);
    expect(comps).toHaveLength(1);
    expect(comps[0]).toHaveLength(3);
  });

  test('components are returned with members sorted by address', () => {
    // Edges (1-3-2) form a single connected component containing {1, 2, 3}.
    const edges = [
      { from: w(3), to: w(1) },
      { from: w(3), to: w(2) },
    ];
    const comps = computeComponents(edges);
    expect(comps).toHaveLength(1);
    expect(comps[0]).toEqual([w(1), w(2), w(3)]);
  });

  test('node mentioned only as `to` ends up in a component', () => {
    const edges = [{ from: w(1), to: w(2) }, { from: w(2), to: w(3) }];
    const comps = computeComponents(edges);
    expect(comps).toHaveLength(1);
    expect(comps[0]).toContain(w(3));
    expect(comps[0]).toHaveLength(3);
  });

  test('parallel edges between the same pair contribute to weighted degree', () => {
    const edges = [
      { from: w(1), to: w(2), weight: 2 },
      { from: w(1), to: w(2), weight: 3 },
    ];
    const ranking = rankByDegree(edges);
    expect(ranking).toHaveLength(2);
    expect(ranking[0].address).toBe(w(1));
    expect(ranking[0].score).toBe(5);
    expect(ranking[1].address).toBe(w(2));
    expect(ranking[1].score).toBe(5);
  });

  test('ties in degree are broken by ascending address (deterministic)', () => {
    const edges = [
      { from: w(2), to: w(3), weight: 1 },
      { from: w(1), to: w(4), weight: 1 },
    ];
    const ranking = rankByDegree(edges);
    // All four nodes have degree 1, so the order must be by address.
    expect(ranking.map((r) => r.address)).toEqual([w(1), w(2), w(3), w(4)]);
  });

  test('zero-weight edges are ignored by the degree ranking', () => {
    const edges = [
      { from: w(1), to: w(2), weight: 0 },
      { from: w(3), to: w(4), weight: 5 },
    ];
    const ranking = rankByDegree(edges);
    expect(ranking).toHaveLength(2);
    // 1 and 2 are not present — zero-weight edges produced no contribution.
    expect(ranking.map((r) => r.address).sort()).toEqual([w(3), w(4)].sort());
    expect(ranking.every((r) => r.score === 5)).toBe(true);
  });

  test('non-finite weights are ignored by the degree ranking (negative is kept)', () => {
    const edges = [
      { from: w(1), to: w(2), weight: -1 }, // finite — kept as -1
      { from: w(3), to: w(4), weight: Number.POSITIVE_INFINITY }, // not finite — dropped
      { from: w(5), to: w(6) }, // no weight field → default 1
    ];
    const ranking = rankByDegree(edges);
    const byAddress = new Map(ranking.map((r) => [r.address, r.score]));
    expect(byAddress.get(w(1))).toBe(-1);
    expect(byAddress.get(w(2))).toBe(-1);
    expect(byAddress.get(w(3))).toBeUndefined();
    expect(byAddress.get(w(4))).toBeUndefined();
    expect(byAddress.get(w(5))).toBe(1);
    expect(byAddress.get(w(6))).toBe(1);
  });

  test('malformed edges are silently skipped', () => {
    const edges = [
      null,
      undefined,
      {},
      { weight: 1 }, // missing from/to
      { from: w(1) }, // missing to
      { to: w(2) }, // missing from
      { from: w(3), to: w(4), weight: 2 }, // valid
    ];
    expect(computeComponents(edges)).toEqual([[w(3), w(4)]]);
    const ranking = rankByDegree(edges);
    expect(ranking).toHaveLength(2);
    expect(ranking.every((r) => r.score === 2)).toBe(true);
  });

  test('self-loop contributes twice to weighted degree', () => {
    const edges = [{ from: w(1), to: w(1), weight: 3 }];
    const ranking = rankByDegree(edges);
    expect(ranking).toEqual([{ address: w(1), score: 6 }]);
    // Self-loop is still a single-node component.
    expect(computeComponents(edges)).toEqual([[w(1)]]);
  });

  test('custom weight function replaces the default', () => {
    const edges = [
      { from: w(1), to: w(2), weight: 100 },
      { from: w(3), to: w(4), weight: 100 },
    ];
    const ranking = rankByDegree(edges, { weight: () => 1 });
    expect(ranking.every((r) => r.score === 1)).toBe(true);
  });

  test('rankByDegree can read weight from a non-default field via custom fn', () => {
    const edges = [
      { from: w(1), to: w(2), volume: 10 },
      { from: w(1), to: w(3), volume: 5 },
    ];
    const ranking = rankByDegree(edges, { weight: (e) => e.volume });
    expect(ranking[0].address).toBe(w(1));
    expect(ranking[0].score).toBe(15);
  });

  test('cluster() output is JSON-serialisable', () => {
    const edges = [
      { from: w(1), to: w(2), weight: 1 },
      { from: w(3), to: w(4), weight: 2 },
    ];
    const out = cluster(edges);
    expect(() => JSON.stringify(out)).not.toThrow();
    const round = JSON.parse(JSON.stringify(out));
    expect(round.components).toEqual(out.components);
    expect(round.ranking).toEqual(out.ranking);
  });
});

describe('graph/clustering — UnionFind', () => {
  test('find returns the same value for a set of connected nodes', () => {
    const uf = new UnionFind();
    uf.union(w(1), w(2));
    uf.union(w(2), w(3));
    expect(uf.find(w(1))).toBe(uf.find(w(3)));
    expect(uf.find(w(1))).toBe(uf.find(w(2)));
  });

  test('find returns distinct values for unconnected nodes', () => {
    const uf = new UnionFind();
    uf.union(w(1), w(2));
    uf.union(w(3), w(4));
    expect(uf.find(w(1))).not.toBe(uf.find(w(3)));
  });

  test('add is idempotent', () => {
    const uf = new UnionFind();
    uf.add(w(1));
    const before = uf.find(w(1));
    uf.add(w(1));
    expect(uf.find(w(1))).toBe(before);
    expect(uf.size()).toBe(1);
  });

  test('union is a no-op when both endpoints are already in the same set', () => {
    const uf = new UnionFind();
    uf.union(w(1), w(2));
    const before = uf.find(w(1));
    uf.union(w(1), w(2));
    expect(uf.find(w(1))).toBe(before);
  });

  test('path compression flattens a deep chain', () => {
    const uf = new UnionFind();
    for (let i = 1; i < 10; i += 1) {
      uf.union(w(i), w(i + 1));
    }
    // After the chain, every parent should be the root.
    for (let i = 1; i <= 10; i += 1) {
      const p = uf.parent.get(w(i));
      expect(p).toBe(uf.find(w(1)));
    }
  });

  test('size reflects the number of distinct nodes added', () => {
    const uf = new UnionFind();
    uf.union(w(1), w(2));
    uf.union(w(2), w(3));
    expect(uf.size()).toBe(3);
    uf.add(w(1)); // idempotent
    expect(uf.size()).toBe(3);
    uf.add(w(99));
    expect(uf.size()).toBe(4);
  });
});
