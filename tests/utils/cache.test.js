// tests/utils/cache.test.js
const { TtlCache } = require('../../src/utils/cache');

describe('utils/cache — TTL', () => {
  describe('constructor and basic invariants', () => {
    test('defaults to a 5-minute (300s) TTL when no options are given', () => {
      const c = new TtlCache();
      c.set('k', 'v');
      expect(c.get('k')).toBe('v');
    });

    test('rejects non-finite ttlSeconds', () => {
      expect(() => new TtlCache({ ttlSeconds: NaN })).toThrow(/ttlSeconds/);
      expect(() => new TtlCache({ ttlSeconds: 'oops' })).toThrow(/ttlSeconds/);
      expect(() => new TtlCache({ ttlSeconds: null })).toThrow(/ttlSeconds/);
      expect(() => new TtlCache({ ttlSeconds: undefined })).not.toThrow();
    });

    test('rejects negative ttlSeconds', () => {
      expect(() => new TtlCache({ ttlSeconds: -1 })).toThrow(/ttlSeconds/);
    });

    test('accepts ttlSeconds = 0 (entries immediately stale, evict on next read)', () => {
      const c = new TtlCache({ ttlSeconds: 0 });
      c.set('k', 'v');
      expect(c.get('k')).toBeUndefined();
    });
  });

  describe('get / set / TTL', () => {
    test('returns undefined for missing keys and counts a miss', () => {
      const c = new TtlCache({ ttlSeconds: 1 });
      expect(c.get('nope')).toBeUndefined();
      expect(c.stats().misses).toBe(1);
      expect(c.stats().hits).toBe(0);
    });

    test('stores and retrieves values within TTL', () => {
      const c = new TtlCache({ ttlSeconds: 5 });
      c.set('k', 'v');
      expect(c.get('k')).toBe('v');
      expect(c.stats().hits).toBe(1);
      expect(c.stats().sets).toBe(1);
    });

    test('set() returns the value', () => {
      const c = new TtlCache({ ttlSeconds: 5 });
      expect(c.set('k', 42)).toBe(42);
    });

    test('expires entries after the TTL elapses', () => {
      let now = 1_000_000;
      const c = new TtlCache({ ttlSeconds: 1, now: () => now });
      c.set('k', 'v');
      now += 500;
      expect(c.get('k')).toBe('v');
      now += 600;
      expect(c.get('k')).toBeUndefined();
    });

    test('eviction on read counts as both a miss and an eviction', () => {
      let now = 0;
      const c = new TtlCache({ ttlSeconds: 1, now: () => now });
      c.set('k', 'v');
      now += 2000;
      expect(c.get('k')).toBeUndefined();
      const s = c.stats();
      expect(s.misses).toBe(1);
      expect(s.evictions).toBe(1);
    });

    test('per-entry TTL override (ttlMs) takes precedence over the constructor default', () => {
      let now = 0;
      const c = new TtlCache({ ttlSeconds: 60, now: () => now });
      c.set('short', 's', { ttlMs: 100 });
      c.set('long', 'l');
      now += 200;
      expect(c.get('short')).toBeUndefined();
      expect(c.get('long')).toBe('l');
    });

    test('refreshing a key with set() resets its expiry', () => {
      let now = 0;
      const c = new TtlCache({ ttlSeconds: 1, now: () => now });
      c.set('k', 'v1');
      now += 500;
      c.set('k', 'v2');
      now += 700;
      expect(c.get('k')).toBe('v2');
    });
  });

  describe('has()', () => {
    test('returns true for a fresh entry, false for a missing or expired one', () => {
      let now = 0;
      const c = new TtlCache({ ttlSeconds: 1, now: () => now });
      expect(c.has('x')).toBe(false);
      c.set('x', 1);
      expect(c.has('x')).toBe(true);
      now += 2000;
      expect(c.has('x')).toBe(false);
    });

    test('has() on an expired entry evicts it from the store', () => {
      let now = 0;
      const c = new TtlCache({ ttlSeconds: 1, now: () => now });
      c.set('x', 1);
      now += 2000;
      c.has('x');
      expect(c.size()).toBe(0);
      expect(c.stats().evictions).toBe(1);
    });
  });

  describe('delete() and clear()', () => {
    test('delete returns true when removing an existing key, false otherwise', () => {
      const c = new TtlCache({ ttlSeconds: 5 });
      c.set('a', 1);
      expect(c.delete('a')).toBe(true);
      expect(c.delete('a')).toBe(false);
      expect(c.delete('never-existed')).toBe(false);
    });

    test('delete removes the entry from the store and from subsequent reads', () => {
      const c = new TtlCache({ ttlSeconds: 5 });
      c.set('a', 1);
      c.delete('a');
      expect(c.get('a')).toBeUndefined();
      expect(c.size()).toBe(0);
    });

    test('clear() empties the store and returns the number of entries removed', () => {
      const c = new TtlCache({ ttlSeconds: 5 });
      c.set('a', 1);
      c.set('b', 2);
      c.set('c', 3);
      expect(c.clear()).toBe(3);
      expect(c.clear()).toBe(0);
      expect(c.size()).toBe(0);
    });

    test('clear() works on an already-empty store', () => {
      const c = new TtlCache({ ttlSeconds: 5 });
      expect(c.clear()).toBe(0);
      expect(c.size()).toBe(0);
    });
  });

  describe('size() and stats()', () => {
    test('size() reports the current number of live entries', () => {
      const c = new TtlCache({ ttlSeconds: 5 });
      expect(c.size()).toBe(0);
      c.set('a', 1);
      c.set('b', 2);
      expect(c.size()).toBe(2);
      c.delete('a');
      expect(c.size()).toBe(1);
    });

    test('stats() includes hits, misses, sets, evictions, and a live size', () => {
      const c = new TtlCache({ ttlSeconds: 5 });
      c.set('a', 1);
      c.get('a');
      c.get('b');
      const s = c.stats();
      expect(s).toEqual(
        expect.objectContaining({
          hits: 1,
          misses: 1,
          sets: 1,
          evictions: 0,
          size: 1,
        }),
      );
    });

    test('stats() returns a fresh object (caller mutations do not corrupt internal state)', () => {
      const c = new TtlCache({ ttlSeconds: 5 });
      c.set('a', 1);
      const s1 = c.stats();
      s1.hits = 999;
      s1.size = 999;
      const s2 = c.stats();
      expect(s2.hits).toBe(0);
      expect(s2.size).toBe(1);
    });

    test('stats counters track realistic workload over many operations', () => {
      let now = 0;
      const c = new TtlCache({ ttlSeconds: 1, now: () => now });
      c.set('a', 1);
      c.set('b', 2);
      c.set('c', 3);
      c.get('a');
      c.get('b');
      c.get('a');
      c.get('missing');
      now += 2000;
      c.get('a');
      c.get('b');
      const s = c.stats();
      expect(s.sets).toBe(3);
      expect(s.hits).toBe(3);
      expect(s.misses).toBe(3);
      expect(s.evictions).toBe(2);
      expect(s.size).toBe(1);
    });
  });

  describe('integration with CACHE_TTL_SECONDS env var (server contract)', () => {
    test('constructor wired with env-style ttlSeconds honours that TTL', () => {
      const envValue = '300';
      const ttlSeconds = Number(envValue || 300);
      let now = 0;
      const c = new TtlCache({ ttlSeconds, now: () => now });
      c.set('k', 'v');
      now += ttlSeconds * 1000 - 1;
      expect(c.get('k')).toBe('v');
      now += 2;
      expect(c.get('k')).toBeUndefined();
    });

    test('default fallback ttlSeconds = 300 (5 minutes) when env is unset', () => {
      const envValue = undefined;
      const ttlSeconds = Number(envValue || 300);
      expect(ttlSeconds).toBe(300);
      const c = new TtlCache({ ttlSeconds });
      c.set('k', 'v');
      expect(c.get('k')).toBe('v');
    });
  });
});
