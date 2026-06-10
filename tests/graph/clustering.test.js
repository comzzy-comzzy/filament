// tests/graph/clustering.test.js
const { computeComponents, rankByDegree, cluster } = require('../../src/graph/clustering');

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
});
