// src/rpc/fallback.js
// Wrap an async RPC function with bounded retries and a typed `RpcError`.
//
// Defaults: 3 attempts, 200 ms linear backoff. The retry policy is
// deliberately conservative because each attempt can cost real RPC
// credits; the limiter upstream in `src/utils/rateLimit.js` ensures we
// don't fan out aggressively.

const { RpcError } = require('../utils/errors');

const DEFAULT_OPTS = Object.freeze({
  retries: 3,
  backoffMs: 200,
  chain: null,
});

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

function isTransient(err) {
  if (!err) return false;
  // Re-throw hard validation errors instead of retrying them.
  if (err.code === 'INVALID_ARGUMENT') return false;
  if (err.code === 'UNSUPPORTED_OPERATION') return false;
  return true;
}

async function callWithFallback(fn, opts = {}) {
  const { retries, backoffMs, chain } = { ...DEFAULT_OPTS, ...opts };
  let lastErr;
  let attempts = 0;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    attempts = attempt;
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === retries) {
        break;
      }
      await sleep(backoffMs * attempt);
    }
  }
  throw new RpcError(
    `RPC call failed after ${attempts} attempt(s)` +
      (chain ? ` on chain ${chain}` : ''),
    { cause: lastErr, chain, attempts },
  );
}

module.exports = { callWithFallback, isTransient };
