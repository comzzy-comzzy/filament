// src/graph/traversal.js
// Breadth-first traversal over an adjacency list. The graph is supplied as
// `{ from: [{to, weight, meta?}, ...] }`; the walk is bounded by
// `MAX_GRAPH_DEPTH` (overridable via options) and never revisits a node. The
// output `{nodes, edges}` is JSON-serialisable and ready for downstream
// heuristics.

const { validateAddress } = require('../utils/checksum');

const DEFAULT_MAX_DEPTH = 3;
const ENV_MAX_DEPTH = 'MAX_GRAPH_DEPTH';

function resolveMaxDepth(value) {
  if (value == null) {
    const envValue = process.env[ENV_MAX_DEPTH];
    if (envValue != null && envValue !== '') {
      const parsed = Number.parseInt(envValue, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }
    return DEFAULT_MAX_DEPTH;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('maxDepth must be a non-negative finite number');
  }
  return Math.floor(value);
}

function bfs(start, adjacency, { maxDepth, getNeighbors } = {}) {
  if (typeof start !== 'string') {
    throw new TypeError('bfs start must be a string wallet address');
  }
  const root = validateAddress(start);
  const limit = resolveMaxDepth(maxDepth);
  const neighbors =
    typeof getNeighbors === 'function'
      ? getNeighbors
      : (node) => (adjacency && adjacency[node]) || [];

  const visited = new Set([root]);
  const nodes = [root];
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
        const edge = {
          from: node,
          to: target,
          depth: depth + 1,
          weight: typeof hop.weight === 'number' ? hop.weight : 1,
          meta: hop.meta || null,
        };
        // Same-target edges (e.g. parallel bridges) are not deduped — each hop
        // is a separate observation, so a second edge to an already-visited
        // node is still meaningful and must be recorded.
        edges.push(edge);
        if (!visited.has(target)) {
          visited.add(target);
          nodes.push(target);
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
    nodes,
    edges,
  };
}

module.exports = {
  bfs,
  resolveMaxDepth,
  DEFAULT_MAX_DEPTH,
  ENV_MAX_DEPTH,
};
