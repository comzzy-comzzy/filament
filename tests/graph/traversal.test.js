// tests/graph/traversal.test.js
const { bfs, resolveMaxDepth } = require('../../src/graph/traversal');
const { toChecksumAddress } = require('../../src/utils/checksum');

function wallet(suffix) {
  return toChecksumAddress('0x' + suffix.toLowerCase().padEnd(40, '0').slice(0, 40));
}

describe('graph/traversal — BFS depth cap and visited set', () => {
  test('stops at maxDepth and never revisits a node', () => {
    const a = wallet('aaaa');
    const b = wallet('bbbb');
    const c = wallet('cccc');
    const d = wallet('dddd');
    const adjacency = {
      [a]: [{ to: b, weight: 1 }, { to: a, weight: 1 }], // self-loop
      [b]: [{ to: c, weight: 1 }, { to: a, weight: 1 }], // back-edge
      [c]: [{ to: d, weight: 1 }],
    };
    const out = bfs(a, adjacency, { maxDepth: 2 });
    expect(out.nodes).toEqual(expect.arrayContaining([a, b, c]));
    expect(out.nodes).not.toContain(d);
    expect(out.depth).toBeLessThanOrEqual(2);
  });

  test('returns nodes and edges arrays', () => {
    const a = wallet('1111');
    const b = wallet('2222');
    const adjacency = { [a]: [{ to: b, weight: 1 }] };
    const out = bfs(a, adjacency, { maxDepth: 1 });
    expect(Array.isArray(out.nodes)).toBe(true);
    expect(Array.isArray(out.edges)).toBe(true);
    expect(out.edges.length).toBe(1);
  });

  test('does not emit duplicate nodes when graph has cycles', () => {
    const a = wallet('a1a1');
    const b = wallet('b2b2');
    const c = wallet('c3c3');
    const adjacency = {
      [a]: [{ to: b, weight: 1 }],
      [b]: [{ to: c, weight: 1 }, { to: a, weight: 1 }], // back-edge to a
      [c]: [{ to: a, weight: 1 }], // back-edge to a
    };
    const out = bfs(a, adjacency, { maxDepth: 3 });
    const set = new Set(out.nodes);
    expect(set.size).toBe(out.nodes.length);
    expect(set.size).toBe(3); // a, b, c — no duplicates
  });

  test('edges may repeat to a visited node but nodes are visited once', () => {
    const a = wallet('d4d4');
    const b = wallet('e5e5');
    const adjacency = {
      [a]: [{ to: b, weight: 1 }, { to: b, weight: 2 }], // two edges a→b
    };
    const out = bfs(a, adjacency, { maxDepth: 1 });
    expect(out.nodes).toEqual([a, b]);
    expect(out.edges.length).toBe(2); // both edges recorded
    expect(out.edges.every((e) => e.to === b)).toBe(true);
  });

  test('honors MAX_GRAPH_DEPTH env var when no override is given', () => {
    const prev = process.env.MAX_GRAPH_DEPTH;
    try {
      const a = wallet('f6f6');
      const b = wallet('07a7');
      const c = wallet('b8b8');
      const d = wallet('c9c9');
      const adjacency = {
        [a]: [{ to: b, weight: 1 }],
        [b]: [{ to: c, weight: 1 }],
        [c]: [{ to: d, weight: 1 }],
      };
      process.env.MAX_GRAPH_DEPTH = '1';
      const out1 = bfs(a, adjacency);
      expect(out1.nodes).toEqual([a, b]);
      expect(out1.depth).toBe(1);

      process.env.MAX_GRAPH_DEPTH = '2';
      const out2 = bfs(a, adjacency);
      expect(out2.nodes).toEqual([a, b, c]);
      expect(out2.depth).toBe(2);
    } finally {
      if (prev === undefined) delete process.env.MAX_GRAPH_DEPTH;
      else process.env.MAX_GRAPH_DEPTH = prev;
    }
  });

  test('explicit maxDepth option overrides MAX_GRAPH_DEPTH env var', () => {
    const prev = process.env.MAX_GRAPH_DEPTH;
    try {
      const a = wallet('d0d0');
      const b = wallet('e1e1');
      const c = wallet('f2f2');
      const d = wallet('a3a3');
      const adjacency = {
        [a]: [{ to: b, weight: 1 }],
        [b]: [{ to: c, weight: 1 }],
        [c]: [{ to: d, weight: 1 }],
      };
      process.env.MAX_GRAPH_DEPTH = '1';
      // Explicit override expands the walk to depth 3
      const out = bfs(a, adjacency, { maxDepth: 3 });
      expect(out.nodes).toEqual([a, b, c, d]);
      expect(out.depth).toBe(3);
    } finally {
      if (prev === undefined) delete process.env.MAX_GRAPH_DEPTH;
      else process.env.MAX_GRAPH_DEPTH = prev;
    }
  });

  test('skips chains of edges whose target would exceed depth', () => {
    const a = wallet('a4a4');
    const b = wallet('b5b5');
    const c = wallet('c6c6');
    const d = wallet('d7d7');
    const adjacency = {
      [a]: [{ to: b, weight: 1 }],
      [b]: [{ to: c, weight: 1 }],
      [c]: [{ to: d, weight: 1 }],
    };
    const out = bfs(a, adjacency, { maxDepth: 0 });
    expect(out.nodes).toEqual([a]);
    expect(out.edges.length).toBe(0);
    expect(out.depth).toBe(0);
  });

  test('returns {root, depth, nodes, edges} in a JSON-serialisable shape', () => {
    const a = wallet('a8a8');
    const b = wallet('b9b9');
    const adjacency = { [a]: [{ to: b, weight: 0.5, meta: { kind: 'bridge' } }] };
    const out = bfs(a, adjacency, { maxDepth: 1 });
    expect(Object.keys(out).sort()).toEqual(['depth', 'edges', 'nodes', 'root']);
    expect(out.root).toBe(a);
    expect(out.edges[0].weight).toBe(0.5);
    expect(out.edges[0].meta).toEqual({ kind: 'bridge' });
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  test('ignores malformed neighbor entries', () => {
    const a = wallet('aa00');
    const b = wallet('bb00');
    const adjacency = {
      [a]: [
        null,
        undefined,
        {},
        { weight: 1 }, // missing `to`
        { to: b, weight: 1 },
      ],
    };
    const out = bfs(a, adjacency, { maxDepth: 1 });
    expect(out.edges.length).toBe(1);
    expect(out.nodes).toEqual([a, b]);
  });

  test('uses getNeighbors callback when supplied', () => {
    const a = wallet('cc00');
    const b = wallet('dd00');
    const c = wallet('ee00');
    let calls = 0;
    const getNeighbors = (node) => {
      calls += 1;
      if (node === a) return [{ to: b, weight: 1 }];
      if (node === b) return [{ to: c, weight: 1 }];
      return [];
    };
    const out = bfs(a, null, { maxDepth: 2, getNeighbors });
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(out.nodes).toEqual([a, b, c]);
  });

  test('rejects non-string start addresses', () => {
    expect(() => bfs(123, {}, { maxDepth: 1 })).toThrow(TypeError);
  });
});

describe('graph/traversal — resolveMaxDepth helper', () => {
  const prev = process.env.MAX_GRAPH_DEPTH;
  afterEach(() => {
    if (prev === undefined) delete process.env.MAX_GRAPH_DEPTH;
    else process.env.MAX_GRAPH_DEPTH = prev;
  });

  test('returns DEFAULT when no value and no env var', () => {
    delete process.env.MAX_GRAPH_DEPTH;
    expect(resolveMaxDepth(undefined)).toBe(3);
    expect(resolveMaxDepth(null)).toBe(3);
  });

  test('reads MAX_GRAPH_DEPTH env var when valid', () => {
    process.env.MAX_GRAPH_DEPTH = '5';
    expect(resolveMaxDepth(undefined)).toBe(5);
  });

  test('ignores garbage env values and falls back to default', () => {
    process.env.MAX_GRAPH_DEPTH = 'not-a-number';
    expect(resolveMaxDepth(undefined)).toBe(3);
  });

  test('throws on negative explicit values', () => {
    expect(() => resolveMaxDepth(-1)).toThrow(RangeError);
  });

  test('floors fractional explicit values', () => {
    expect(resolveMaxDepth(2.7)).toBe(2);
  });
});
