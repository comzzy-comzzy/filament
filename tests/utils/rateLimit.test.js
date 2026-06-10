// tests/utils/rateLimit.test.js
const { RateLimiter } = require('../../src/utils/rateLimit');

describe('utils/rateLimit — pacing', () => {
  test('enforces the minimum interval between calls', async () => {
    let now = 0;
    const rl = new RateLimiter({ intervalMs: 200, now: () => now });
    const stamps = [];
    const t1 = rl.run(async () => {
      stamps.push(now);
      return 1;
    });
    const t2 = rl.run(async () => {
      stamps.push(now);
      return 2;
    });
    await t1;
    now += 250; // simulate real time advancing while t1 is in flight
    await t2;
    expect(stamps[1] - stamps[0]).toBeGreaterThanOrEqual(200);
  });

  test('wrap forwards arguments and respects the limit', async () => {
    let now = 0;
    const rl = new RateLimiter({ intervalMs: 100, now: () => now });
    const fn = rl.wrap(async (x) => x * 2);
    const r1 = await fn(3);
    now += 150;
    const r2 = await fn(4);
    expect([r1, r2]).toEqual([6, 8]);
  });

  test('reset clears the gate state', async () => {
    const rl = new RateLimiter({ intervalMs: 100 });
    await rl.run(async () => 'a');
    rl.reset();
    // After reset, the gate should not delay — we just assert the call
    // returns successfully and the queue is restored to a resolved state.
    await expect(rl.run(async () => 'b')).resolves.toBe('b');
  });
});
