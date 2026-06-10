// src/utils/cache.js
// In-memory TTL cache for expensive RPC-derived data.
//
// Behaviour:
//   * Keys expire after `ttlSeconds` (read fresh on every call).
//   * `delete(key)` and `clear()` operate on the live entries.
//   * `stats()` returns {hits, misses, sets, evictions, size} for observability.
//   * The cache is process-local; no disk or shared memory.

class TtlCache {
  constructor({ ttlSeconds = 300, now = () => Date.now() } = {}) {
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 0) {
      throw new Error('ttlSeconds must be a non-negative number');
    }
    this.ttlMs = ttlSeconds * 1000;
    this.now = now;
    this.store = new Map();
    this._stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this._stats.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      this._stats.misses += 1;
      this._stats.evictions += 1;
      return undefined;
    }
    this._stats.hits += 1;
    return entry.value;
  }

  set(key, value, { ttlMs } = {}) {
    const expiresAt = this.now() + (ttlMs != null ? ttlMs : this.ttlMs);
    this.store.set(key, { value, expiresAt });
    this._stats.sets += 1;
    return value;
  }

  has(key) {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      this._stats.evictions += 1;
      return false;
    }
    return true;
  }

  delete(key) {
    return this.store.delete(key);
  }

  clear() {
    const size = this.store.size;
    this.store.clear();
    return size;
  }

  size() {
    return this.store.size;
  }

  stats() {
    return { ...this._stats, size: this.store.size };
  }
}

module.exports = { TtlCache };
