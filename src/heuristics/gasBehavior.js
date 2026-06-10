// src/heuristics/gasBehavior.js
// Builds a behavioural gas signature from per-chain gas-price samples and
// scores cross-chain similarity. Each dimension (base-fee hugging, tip
// precision, gas-limit preference) is normalised to 0..1.

const { clamp01 } = require('../scoring/confidenceEngine');
const NO_DATA = { score: 0, evidence: { reason: 'no_data' }, fired: false };

function summarise(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const baseFees = samples.map((s) => Number(s.baseFee || 0));
  const tips = samples.map((s) => Number(s.tip || 0));
  const limits = samples.map((s) => Number(s.gasLimit || 0));
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    baseFeeMean: mean(baseFees),
    tipMean: mean(tips),
    limitMean: mean(limits),
    sampleCount: samples.length,
  };
}

function cosine(a, b) {
  if (!a || !b) return 0;
  const dot = a.baseFeeMean * b.baseFeeMean + a.tipMean * b.tipMean + a.limitMean * b.limitMean;
  const na = Math.hypot(a.baseFeeMean, a.tipMean, a.limitMean) || 1;
  const nb = Math.hypot(b.baseFeeMean, b.tipMean, b.limitMean) || 1;
  return clamp01(dot / (na * nb));
}

async function run(input = {}, _ctx = {}) {
  try {
    const samplesByChain = input.samplesByChain || {};
    const chains = Object.keys(samplesByChain);
    if (chains.length < 2) {
      return { ...NO_DATA };
    }
    const summaries = chains
      .map((c) => ({ chain: c, summary: summarise(samplesByChain[c]) }))
      .filter((s) => s.summary);
    if (summaries.length < 2) {
      return { ...NO_DATA };
    }
    let best = 0;
    for (let i = 0; i < summaries.length; i += 1) {
      for (let j = i + 1; j < summaries.length; j += 1) {
        best = Math.max(best, cosine(summaries[i].summary, summaries[j].summary));
      }
    }
    return {
      score: best,
      evidence: {
        chains: summaries.map((s) => s.chain),
        summaries: summaries.map((s) => ({ chain: s.chain, ...s.summary })),
        bestCosine: best,
      },
      fired: best > 0.4,
    };
  } catch (_) {
    return { ...NO_DATA };
  }
}

module.exports = { run, summarise, cosine };
