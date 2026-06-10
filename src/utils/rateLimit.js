// src/utils/rateLimit.js
// Serial rate-limit gate. Every call to `run` / `wrap` ensures at least
// `intervalMs` milliseconds have elapsed since the previous call.
//
// The gate is intentionally simple (no queue, no token bucket) because the
// hot path is sequential async/await; concurrent callers serialise themselves
// behind a single in-flight promise chain.

class RateLimiter {
  constructor({ intervalMs = 200, now = () => Date.now() } = {}) {
    if (!Number.isFinite(intervalMs) || intervalMs < 0) {
      throw new Error('intervalMs must be a non-negative number');
    }
    this.intervalMs = intervalMs;
    this.now = now;
    this.lastCallAt = 0;
    this.queue = Promise.resolve();
  }

  async run(fn) {
    // Chain onto the existing queue so multiple callers serialise.
    const next = this.queue.then(() => this._invoke(fn));
    // Keep the queue healthy even if a caller rejects.
    this.queue = next.catch(() => undefined);
    return next;
  }

  wrap(fn) {
    const limiter = this;
    return function wrapped(...args) {
      return limiter.run(() => fn.apply(this, args));
    };
  }

  reset() {
    this.lastCallAt = 0;
    this.queue = Promise.resolve();
  }

  async _invoke(fn) {
    const elapsed = this.now() - this.lastCallAt;
    if (elapsed < this.intervalMs) {
      const wait = this.intervalMs - elapsed;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, wait);
        if (typeof timer.unref === 'function') timer.unref();
      });
    }
    this.lastCallAt = this.now();
    return fn();
  }
}

module.exports = { RateLimiter };
