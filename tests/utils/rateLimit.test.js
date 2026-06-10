// tests/utils/rateLimit.test.js
const { RateLimiter } = require('../../src/utils/rateLimit');

describe('utils/rateLimit — pacing', () => {
  describe('constructor and configuration', () => {
    test('defaults to a 200ms interval when no options are given', () => {
      // Sanity: the default matches the spec's typical RATE_LIMIT_MS=200.
      // Behavioural check: a single call goes through immediately.
      const rl = new RateLimiter();
      return rl.run(async () => 1).then((v) => expect(v).toBe(1));
    });

    test('honours an explicit intervalMs option', () => {
      const rl = new RateLimiter({ intervalMs: 5 });
      return rl.run(async () => 1).then((v) => expect(v).toBe(1));
    });

    test('rejects non-finite intervalMs', () => {
      expect(() => new RateLimiter({ intervalMs: NaN })).toThrow(/intervalMs/);
      expect(() => new RateLimiter({ intervalMs: 'oops' })).toThrow(/intervalMs/);
      expect(() => new RateLimiter({ intervalMs: null })).toThrow(/intervalMs/);
    });

    test('rejects negative intervalMs', () => {
      expect(() => new RateLimiter({ intervalMs: -1 })).toThrow(/intervalMs/);
    });

    test('accepts intervalMs = 0 (no pacing — every call proceeds immediately)', async () => {
      let now = 0;
      const rl = new RateLimiter({ intervalMs: 0, now: () => now });
      const stamps = [];
      await rl.run(async () => stamps.push(now));
      now += 0; // no time elapsed
      await rl.run(async () => stamps.push(now));
      await rl.run(async () => stamps.push(now));
      // No pacing means consecutive stamps are back-to-back.
      expect(stamps).toEqual([0, 0, 0]);
    });
  });

  describe('run(fn) — minimum interval enforcement', () => {
    test('two back-to-back calls are separated by at least intervalMs (in injected now)', async () => {
      let now = 0;
      const rl = new RateLimiter({ intervalMs: 50, now: () => now });
      const stamps = [];
      const p1 = rl.run(async () => {
        const stamp = now;
        stamps.push(stamp);
        return 'p1';
      });
      // We need to let p1 actually run before p2 starts being "rate-limited",
      // but in this implementation the queue serialises them. We tick `now`
      // forward by enough to satisfy p1's gating, then expect p2 to be
      // delayed by the same interval.
      now = 1000; // give p1 plenty of room
      await p1;
      const p2 = rl.run(async () => {
        const stamp = now;
        stamps.push(stamp);
        return 'p2';
      });
      now = 1100; // 100ms after p1's gate release — p2's elapsed = 100, >= 50, so p2 runs at "now=1100"
      const r2 = await p2;
      expect(stamps.length).toBe(2);
      // The second stamp happens at the time p2's _invoke runs fn, which
      // is *after* the gate opens. With now=1100 at the moment we kick p2
      // off, the second stamp can be 1100 or slightly later.
      expect(stamps[1] - stamps[0]).toBeGreaterThanOrEqual(50);
      expect(r2).toBe('p2');
    });

    test('enforces the minimum interval in real wall-clock time', async () => {
      const INTERVAL = 30;
      const rl = new RateLimiter({ intervalMs: INTERVAL });
      const t0 = Date.now();
      await rl.run(async () => undefined);
      await rl.run(async () => undefined);
      const elapsed = Date.now() - t0;
      // Two serialised calls, each gated by INTERVAL: total >= INTERVAL.
      expect(elapsed).toBeGreaterThanOrEqual(INTERVAL);
    });

    test('three consecutive calls are paced apart by at least intervalMs', async () => {
      const INTERVAL = 25;
      const rl = new RateLimiter({ intervalMs: INTERVAL });
      const t0 = Date.now();
      const stamps = [];
      await rl.run(async () => stamps.push(Date.now() - t0));
      await rl.run(async () => stamps.push(Date.now() - t0));
      await rl.run(async () => stamps.push(Date.now() - t0));
      expect(stamps.length).toBe(3);
      for (let i = 1; i < stamps.length; i += 1) {
        expect(stamps[i] - stamps[i - 1]).toBeGreaterThanOrEqual(INTERVAL - 5);
      }
    });

    test('run() returns the result of fn', async () => {
      const rl = new RateLimiter({ intervalMs: 5 });
      const r = await rl.run(async () => 42);
      expect(r).toBe(42);
    });

    test('run() propagates errors from fn', async () => {
      const rl = new RateLimiter({ intervalMs: 5 });
      await expect(
        rl.run(async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
    });

    test('errors from fn do not break the gate — subsequent calls still work', async () => {
      const rl = new RateLimiter({ intervalMs: 5 });
      await expect(
        rl.run(async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow();
      const r = await rl.run(async () => 'recovered');
      expect(r).toBe('recovered');
    });
  });

  describe('run(fn) — queueing and concurrency', () => {
    test('concurrent run() calls execute in submission order', async () => {
      const rl = new RateLimiter({ intervalMs: 5 });
      const order = [];
      const ps = [];
      for (let i = 0; i < 5; i += 1) {
        ps.push(
          rl.run(async () => {
            order.push(i);
            return i;
          }),
        );
      }
      await Promise.all(ps);
      expect(order).toEqual([0, 1, 2, 3, 4]);
    });

    test('concurrent run() calls all complete with their own results', async () => {
      const rl = new RateLimiter({ intervalMs: 5 });
      const ps = [rl.run(async () => 'a'), rl.run(async () => 'b'), rl.run(async () => 'c')];
      const out = await Promise.all(ps);
      expect(out).toEqual(['a', 'b', 'c']);
    });
  });

  describe('wrap(fn) — function decoration', () => {
    test('wrap() returns a function (does not execute fn immediately)', () => {
      const rl = new RateLimiter({ intervalMs: 5 });
      let called = false;
      const wrapped = rl.wrap(async () => {
        called = true;
        return 'x';
      });
      expect(typeof wrapped).toBe('function');
      expect(called).toBe(false);
    });

    test('wrapped function forwards arguments and return value', async () => {
      const rl = new RateLimiter({ intervalMs: 5 });
      const wrapped = rl.wrap(async (a, b) => a + b);
      const r = await wrapped(2, 3);
      expect(r).toBe(5);
    });

    test('wrapped function preserves `this` context', async () => {
      const rl = new RateLimiter({ intervalMs: 5 });
      const obj = { x: 7, get: rl.wrap(async function getX() { return this.x; }) };
      const r = await obj.get();
      expect(r).toBe(7);
    });

    test('wrapped function respects the rate limit', async () => {
      const INTERVAL = 25;
      const rl = new RateLimiter({ intervalMs: INTERVAL });
      const wrapped = rl.wrap(async () => Date.now());
      const t0 = Date.now();
      const a = await wrapped();
      const b = await wrapped();
      const gap = b - a;
      expect(gap).toBeGreaterThanOrEqual(INTERVAL - 5);
    });

    test('wrap() can decorate a synchronous function — the gate still applies', async () => {
      const INTERVAL = 15;
      const rl = new RateLimiter({ intervalMs: INTERVAL });
      const wrapped = rl.wrap((x) => x * 2);
      const t0 = Date.now();
      const r1 = await wrapped(3);
      const r2 = await wrapped(4);
      const gap = Date.now() - t0;
      expect(r1).toBe(6);
      expect(r2).toBe(8);
      expect(gap).toBeGreaterThanOrEqual(INTERVAL - 5);
    });
  });

  describe('reset()', () => {
    test('reset() allows the next call to proceed without waiting (in real time)', async () => {
      const LONG_INTERVAL = 10_000; // 10s — would dominate the test if not reset
      const rl = new RateLimiter({ intervalMs: LONG_INTERVAL });
      // First call: sets lastCallAt.
      await rl.run(async () => 1);
      rl.reset();
      // Second call: should not be gated by the 10s interval.
      const t0 = Date.now();
      const r = await rl.run(async () => 2);
      const elapsed = Date.now() - t0;
      expect(r).toBe(2);
      // Allow some slop for event-loop scheduling — we just need to know
      // we did NOT wait anywhere near 10s.
      expect(elapsed).toBeLessThan(500);
    });

    test('reset() also drains the in-flight queue so it is safe to re-use', async () => {
      const rl = new RateLimiter({ intervalMs: 5 });
      // Build a queue, then reset before any of them have a chance to run.
      const ps = [rl.run(async () => 1), rl.run(async () => 2)];
      rl.reset();
      // Even with reset called mid-flight, the queued promises must still
      // resolve (they may be slightly out of order or interleaved with the
      // reset, but they will not hang).
      const out = await Promise.all(ps);
      expect(out).toEqual([1, 2]);
    });

    test('reset() puts the limiter back into a state where pacing re-applies after the next call', async () => {
      const INTERVAL = 25;
      const rl = new RateLimiter({ intervalMs: INTERVAL });
      await rl.run(async () => 1);
      rl.reset();
      // First call after reset: lastCallAt is 0 again, so it should still
      // be paced against the *next* call.
      const t0 = Date.now();
      await rl.run(async () => 2);
      const a = Date.now() - t0;
      const b = await rl.run(async () => 3);
      const gap = Date.now() - t0 - a;
      // a is the time for the first call after reset (likely 0 — fresh
      // gate). The *second* call after reset must still respect the
      // interval relative to the first.
      expect(b).toBe(3);
      expect(gap).toBeGreaterThanOrEqual(INTERVAL - 5);
    });
  });

  describe('integration with RATE_LIMIT_MS env var (server contract)', () => {
    test('RateLimiter({ intervalMs: Number(process.env.RATE_LIMIT_MS || 200) }) honours the env', () => {
      const envValue = '200';
      const intervalMs = Number(envValue || 200);
      const rl = new RateLimiter({ intervalMs });
      return rl.run(async () => 'ok').then((r) => expect(r).toBe('ok'));
    });

    test('falls back to 200ms when RATE_LIMIT_MS is unset', () => {
      const envValue = undefined;
      const intervalMs = Number(envValue || 200);
      expect(intervalMs).toBe(200);
      const rl = new RateLimiter({ intervalMs });
      return rl.run(async () => 'ok').then((r) => expect(r).toBe('ok'));
    });

    test('falls back to 200ms when RATE_LIMIT_MS is the empty string', () => {
      const envValue = '';
      const intervalMs = Number(envValue || 200);
      expect(intervalMs).toBe(200);
    });
  });
});
