// tests/rpc/fallback.test.js
const { callWithFallback, isTransient } = require('../../src/rpc/fallback');
const { RpcError } = require('../../src/utils/errors');

describe('rpc/fallback — callWithFallback()', () => {
  describe('happy path', () => {
    test('returns the value on the first attempt (no retries needed)', async () => {
      let calls = 0;
      const out = await callWithFallback(async () => {
        calls += 1;
        return 42;
      });
      expect(out).toBe(42);
      expect(calls).toBe(1);
    });

    test('returns the value after one transient retry', async () => {
      let calls = 0;
      const out = await callWithFallback(
        async () => {
          calls += 1;
          if (calls < 2) {
            const e = new Error('transient');
            e.code = 'ECONNRESET';
            throw e;
          }
          return 'ok';
        },
        { retries: 3, backoffMs: 1 },
      );
      expect(out).toBe('ok');
      expect(calls).toBe(2);
    });

    test('passes the attempt index (1-based) to fn', async () => {
      const seen = [];
      await callWithFallback(
        async (attempt) => {
          seen.push(attempt);
          if (attempt < 3) {
            const e = new Error('flaky');
            e.code = 'ETIMEDOUT';
            throw e;
          }
          return 'ok';
        },
        { retries: 5, backoffMs: 1 },
      );
      expect(seen).toEqual([1, 2, 3]);
    });
  });

  describe('retry policy — transient failures', () => {
    test('retries up to 3 times then throws RpcError', async () => {
      let calls = 0;
      const fn = async () => {
        calls += 1;
        const err = new Error('boom');
        err.code = 'ECONNRESET';
        throw err;
      };
      await expect(
        callWithFallback(fn, { retries: 3, backoffMs: 1 }),
      ).rejects.toBeInstanceOf(RpcError);
      expect(calls).toBe(3);
    });

    test('default retries is 3 (matches AC-9 spec)', async () => {
      let calls = 0;
      const fn = async () => {
        calls += 1;
        const err = new Error('boom');
        err.code = 'SERVER_ERROR';
        throw err;
      };
      await expect(
        callWithFallback(fn, { backoffMs: 1 }),
      ).rejects.toBeInstanceOf(RpcError);
      expect(calls).toBe(3);
    });

    test('respects a custom retries value (e.g. 5)', async () => {
      let calls = 0;
      const fn = async () => {
        calls += 1;
        const err = new Error('boom');
        err.code = 'ECONNRESET';
        throw err;
      };
      await expect(
        callWithFallback(fn, { retries: 5, backoffMs: 1 }),
      ).rejects.toBeInstanceOf(RpcError);
      expect(calls).toBe(5);
    });

    test('respects retries: 1 (no retry, just one attempt)', async () => {
      let calls = 0;
      const fn = async () => {
        calls += 1;
        const err = new Error('boom');
        err.code = 'ECONNRESET';
        throw err;
      };
      await expect(
        callWithFallback(fn, { retries: 1, backoffMs: 1 }),
      ).rejects.toBeInstanceOf(RpcError);
      expect(calls).toBe(1);
    });
  });

  describe('retry policy — non-transient failures (no retry)', () => {
    test('does not retry on INVALID_ARGUMENT', async () => {
      let calls = 0;
      const fn = async () => {
        calls += 1;
        const err = new Error('bad arg');
        err.code = 'INVALID_ARGUMENT';
        throw err;
      };
      await expect(
        callWithFallback(fn, { retries: 3, backoffMs: 1 }),
      ).rejects.toBeInstanceOf(RpcError);
      expect(calls).toBe(1);
    });

    test('does not retry on UNSUPPORTED_OPERATION', async () => {
      let calls = 0;
      const fn = async () => {
        calls += 1;
        const err = new Error('unsupported');
        err.code = 'UNSUPPORTED_OPERATION';
        throw err;
      };
      await expect(
        callWithFallback(fn, { retries: 3, backoffMs: 1 }),
      ).rejects.toBeInstanceOf(RpcError);
      expect(calls).toBe(1);
    });

    test('a non-Error rejection is also treated as transient (retried)', async () => {
      let calls = 0;
      const fn = async () => {
        calls += 1;
        // throwing a string — no `code` field at all
        throw `string-error-${calls}`;
      };
      await expect(
        callWithFallback(fn, { retries: 3, backoffMs: 1 }),
      ).rejects.toBeInstanceOf(RpcError);
      expect(calls).toBe(3);
    });
  });

  describe('RpcError surface', () => {
    test('the thrown RpcError carries the original error as `cause`', async () => {
      const original = new Error('transient network glitch');
      original.code = 'ECONNRESET';
      let caught;
      try {
        await callWithFallback(
          async () => {
            throw original;
          },
          { retries: 2, backoffMs: 1 },
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RpcError);
      expect(caught.cause).toBe(original);
    });

    test('the RpcError.attempts field reflects the ACTUAL number of attempts (not the retries budget)', async () => {
      let caught;
      try {
        await callWithFallback(
          async () => {
            const e = new Error('bad arg');
            e.code = 'INVALID_ARGUMENT';
            throw e;
          },
          { retries: 5, backoffMs: 1 },
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RpcError);
      expect(caught.attempts).toBe(1);
    });

    test('the RpcError.attempts field equals retries when all attempts are exhausted', async () => {
      let caught;
      try {
        await callWithFallback(
          async () => {
            const e = new Error('boom');
            e.code = 'TIMEOUT';
            throw e;
          },
          { retries: 3, backoffMs: 1 },
        );
      } catch (e) {
        caught = e;
      }
      expect(caught.attempts).toBe(3);
    });

    test('the RpcError includes the chain name when supplied', async () => {
      let caught;
      try {
        await callWithFallback(
          async () => {
            const e = new Error('boom');
            e.code = 'ECONNRESET';
            throw e;
          },
          { retries: 2, backoffMs: 1, chain: 'arbitrum' },
        );
      } catch (e) {
        caught = e;
      }
      expect(caught.chain).toBe('arbitrum');
      expect(caught.message).toMatch(/on chain arbitrum/);
    });

    test('the RpcError.chain defaults to null when no chain is supplied', async () => {
      let caught;
      try {
        await callWithFallback(
          async () => {
            const e = new Error('boom');
            e.code = 'ECONNRESET';
            throw e;
          },
          { retries: 2, backoffMs: 1 },
        );
      } catch (e) {
        caught = e;
      }
      expect(caught.chain).toBeNull();
      expect(caught.message).not.toMatch(/on chain/);
    });

    test('the RpcError.name is "RpcError"', async () => {
      let caught;
      try {
        await callWithFallback(
          async () => {
            throw new Error('boom');
          },
          { retries: 1 },
        );
      } catch (e) {
        caught = e;
      }
      expect(caught.name).toBe('RpcError');
    });

    test('the RpcError message counts the ACTUAL attempts, not the budget', async () => {
      let caught;
      try {
        await callWithFallback(
          async () => {
            const e = new Error('bad arg');
            e.code = 'INVALID_ARGUMENT';
            throw e;
          },
          { retries: 5, backoffMs: 1 },
        );
      } catch (e) {
        caught = e;
      }
      // We made 1 attempt (and exited on the non-transient error).
      expect(caught.message).toMatch(/after 1 attempt/);
    });
  });

  describe('backoff pacing', () => {
    test('sleeps linearly (backoffMs * attempt) between retries', async () => {
      const sleeps = [];
      const realSleep = callWithFallback; // alias for documentation
      // Patch global setTimeout to observe the wait durations.
      const origSetTimeout = global.setTimeout;
      global.setTimeout = (fn, ms) => {
        sleeps.push(ms);
        return origSetTimeout(fn, 0);
      };
      try {
        const fn = async () => {
          const e = new Error('boom');
          e.code = 'ECONNRESET';
          throw e;
        };
        await expect(
          callWithFallback(fn, { retries: 3, backoffMs: 100 }),
        ).rejects.toBeInstanceOf(RpcError);
      } finally {
        global.setTimeout = origSetTimeout;
      }
      // The gate sleeps between attempt 1->2 and 2->3, NOT after the final
      // attempt (because the loop breaks on the last one). Two sleeps total.
      expect(sleeps.length).toBe(2);
      expect(sleeps[0]).toBe(100); // backoffMs * 1
      expect(sleeps[1]).toBe(200); // backoffMs * 2
    });

    test('no sleep after the last (failed) attempt', async () => {
      const sleeps = [];
      const origSetTimeout = global.setTimeout;
      global.setTimeout = (fn, ms) => {
        sleeps.push(ms);
        return origSetTimeout(fn, 0);
      };
      try {
        const fn = async () => {
          const e = new Error('boom');
          e.code = 'ECONNRESET';
          throw e;
        };
        await expect(
          callWithFallback(fn, { retries: 2, backoffMs: 50 }),
        ).rejects.toBeInstanceOf(RpcError);
      } finally {
        global.setTimeout = origSetTimeout;
      }
      // 2 attempts, 1 sleep between them.
      expect(sleeps.length).toBe(1);
      expect(sleeps[0]).toBe(50);
    });

    test('backoffMs: 0 still serialises the retries (no wait)', async () => {
      let calls = 0;
      const fn = async () => {
        calls += 1;
        const e = new Error('boom');
        e.code = 'ECONNRESET';
        throw e;
      };
      const t0 = Date.now();
      await expect(
        callWithFallback(fn, { retries: 3, backoffMs: 0 }),
      ).rejects.toBeInstanceOf(RpcError);
      const elapsed = Date.now() - t0;
      expect(calls).toBe(3);
      // We just verify it didn't take ages — under 200ms is more than safe.
      expect(elapsed).toBeLessThan(200);
    });
  });
});

describe('rpc/fallback — isTransient()', () => {
  test('classifies known network codes as transient', () => {
    expect(isTransient({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransient({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isTransient({ code: 'ECONNREFUSED' })).toBe(true);
    expect(isTransient({ code: 'SERVER_ERROR' })).toBe(true);
  });

  test('classifies known validation codes as non-transient', () => {
    expect(isTransient({ code: 'INVALID_ARGUMENT' })).toBe(false);
    expect(isTransient({ code: 'UNSUPPORTED_OPERATION' })).toBe(false);
  });

  test('classifies errors without a `code` as transient (default)', () => {
    expect(isTransient(new Error('no code'))).toBe(true);
    expect(isTransient({})).toBe(true);
  });

  test('returns false for null/undefined/empty inputs', () => {
    expect(isTransient(null)).toBe(false);
    expect(isTransient(undefined)).toBe(false);
    expect(isTransient(0)).toBe(false);
    expect(isTransient('')).toBe(false);
  });
});
