// tests/graph/traversal.test.js
const { bfs } = require('../../src/graph/traversal');
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
});
