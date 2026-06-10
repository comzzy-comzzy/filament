// tests/utils/cache.test.js
const { TtlCache } = require('../../src/utils/cache');

describe('utils/cache — TTL', () => {
  test('returns undefined for missing keys and counts a miss', () => {
    const c = new TtlCache({ ttlSeconds: 1 });
    expect(c.get('nope')).toBeUndefined();
    expect(c.stats().misses).toBe(1);
  });

  test('stores and retrieves values within TTL', () => {
    const c = new TtlCache({ ttlSeconds: 5 });
    c.set('k', 'v');
    expect(c.get('k')).toBe('v');
    expect(c.stats().hits).toBe(1);
  });

  test('expires entries after the TTL elapses', () => {
    let now = 0;
    const c = new TtlCache({ ttlSeconds: 1, now: () => now });
    c.set('k', 'v');
    now += 500;
    expect(c.get('k')).toBe('v');
    now += 1500;
    expect(c.get('k')).toBeUndefined();
  });

  test('delete and clear operate on the store', () => {
    const c = new TtlCache({ ttlSeconds: 5 });
    c.set('a', 1);
    c.set('b', 2);
    expect(c.delete('a')).toBe(true);
    expect(c.get('a')).toBeUndefined();
    expect(c.clear()).toBe(1);
    expect(c.get('b')).toBeUndefined();
  });
});
