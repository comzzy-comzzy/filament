// src/heuristics/deploymentDna.js
// Hashes contract init-code / constructor byte sequences and looks for
// cross-chain collisions. Identical DNA from the same deployer is a strong
// shared-operator signal.

const { createHash } = require('crypto');
const { clamp01 } = require('../scoring/confidenceEngine');
const NO_DATA = { score: 0, evidence: { reason: 'no_data' }, fired: false };

function fingerprint(bytecode) {
  if (!bytecode || typeof bytecode !== 'string') return null;
  return createHash('sha256').update(bytecode.toLowerCase()).digest('hex');
}

async function run(input = {}, _ctx = {}) {
  try {
    const deployments = Array.isArray(input.deployments) ? input.deployments : [];
    if (deployments.length === 0) {
      return { ...NO_DATA };
    }
    const hashed = deployments
      .map((d) => ({ ...d, fingerprint: fingerprint(d.bytecode) }))
      .filter((d) => d.fingerprint);
    if (hashed.length === 0) {
      return { ...NO_DATA };
    }
    const counts = new Map();
    for (const d of hashed) {
      counts.set(d.fingerprint, (counts.get(d.fingerprint) || 0) + 1);
    }
    let collisions = 0;
    let topFingerprint = null;
    let topCount = 0;
    for (const [fp, n] of counts) {
      if (n > topCount) {
        topCount = n;
        topFingerprint = fp;
      }
      if (n > 1) collisions += n - 1;
    }
    const score = clamp01(collisions / Math.max(1, hashed.length));
    return {
      score,
      evidence: {
        deployments: hashed.length,
        collisions,
        topFingerprint,
        topCount,
      },
      fired: score > 0,
    };
  } catch (_) {
    return { ...NO_DATA };
  }
}

module.exports = { run, fingerprint };
