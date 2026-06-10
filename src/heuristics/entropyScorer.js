// src/heuristics/entropyScorer.js
// Scores how "low-entropy" a set of child addresses looks. Real HD wallets
// produce uniformly random addresses; vanity generators and bespoke
// derivation schemes do not.

const { clamp01 } = require('../scoring/confidenceEngine');
const NO_DATA = { score: 0, evidence: { reason: 'no_data' }, fired: false };

const HEX = '0123456789abcdef';

function shannonEntropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  const total = s.length || 1;
  let h = 0;
  for (const n of counts.values()) {
    const p = n / total;
    h -= p * Math.log2(p);
  }
  return h;
}

function sequentialSuffix(addresses) {
  let count = 0;
  for (let i = 1; i < addresses.length; i += 1) {
    const prev = BigInt(addresses[i - 1]);
    const cur = BigInt(addresses[i]);
    if (cur - prev === 1n) count += 1;
  }
  return count;
}

function repeatedByteRuns(addresses) {
  let total = 0;
  for (const a of addresses) {
    const body = a.slice(2).toLowerCase();
    let run = 1;
    for (let i = 1; i < body.length; i += 1) {
      if (body[i] === body[i - 1]) {
        run += 1;
        if (run >= 4) {
          total += 1;
          break;
        }
      } else {
        run = 1;
      }
    }
  }
  return total;
}

async function run(input = {}, _ctx = {}) {
  try {
    const addresses = Array.isArray(input.addresses) ? input.addresses : [];
    if (addresses.length < 2) {
      return { ...NO_DATA };
    }
    const entropies = addresses.map((a) => {
      const body = String(a).slice(2, 42).toLowerCase();
      return shannonEntropy(body);
    });
    const meanEntropy = entropies.reduce((a, b) => a + b, 0) / entropies.length;
    // The body of a 40-char hex string has max entropy log2(16) = 4. Lower
    // observed entropy is a strong signal of generator bias.
    const entropyDeficit = clamp01(1 - meanEntropy / 4);
    const seqBonus = clamp01(sequentialSuffix(addresses) / addresses.length);
    const repeatBonus = clamp01(repeatedByteRuns(addresses) / addresses.length);
    const score = clamp01(
      0.5 * entropyDeficit + 0.3 * seqBonus + 0.2 * repeatBonus,
    );
    return {
      score,
      evidence: {
        sampleCount: addresses.length,
        meanEntropy,
        sequentialPairs: sequentialSuffix(addresses),
        repeatedByteAddresses: repeatedByteRuns(addresses),
      },
      fired: score > 0.15,
    };
  } catch (_) {
    return { ...NO_DATA };
  }
}

module.exports = {
  run,
  shannonEntropy,
  sequentialSuffix,
  repeatedByteRuns,
  // Expose for tests; not part of the public surface.
  _HEX: HEX,
};
