// src/graph/traversal.js
// Breadth-first traversal over an adjacency list. The graph is supplied as
// `{ from: [{to, weight, meta?}, ...] }`; the walk is bounded by
// `maxDepth` and never revisits a node. The output `{nodes, edges}` is
// JSON-serialisable and ready for downstream heuristics.

const { validateAddress } = require('../utils/checksum');

function bfs(start, adjacency, { maxDepth = 3, getNeighbors } = {}) {
  if (typeof start !== 'string') {
    throw new TypeError('bfs start must be a string wallet address');
  }
  const root = validateAddress(start);
  const limit = Number.isFinite(maxDepth) ? Math.max(0, Math.floor(maxDepth)) : 3;
  const neighbors = getNeighbors || ((node) => adjacency[node] || []);

  const nodes = new Set([root]);
  const edges = [];
  let frontier = [root];
  let depth = 0;

  while (frontier.length > 0 && depth < limit) {
    const next = [];
    for (const node of frontier) {
      const hops = neighbors(node) || [];
      for (const hop of hops) {
        if (!hop || !hop.to) continue;
        const target = validateAddress(hop.to);
        edges.push({
          from: node,
          to: target,
          depth: depth + 1,
          weight: typeof hop.weight === 'number' ? hop.weight : 1,
          meta: hop.meta || null,
        });
        if (!nodes.has(target)) {
          nodes.add(target);
          next.push(target);
        }
      }
    }
    frontier = next;
    depth += 1;
  }

  return {
    root,
    depth,
    nodes: Array.from(nodes),
    edges,
  };
}

module.exports = { bfs };
