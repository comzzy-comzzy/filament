// tests/rpc/fallback.test.js
const { callWithFallback, isTransient } = require('../../src/rpc/fallback');
const { RpcError } = require('../../src/utils/errors');

describe('rpc/fallback', () => {
  test('retries up to 3 times then throws RpcError', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      const err = new Error('boom');
      err.code = 'ECONNRESET';
      throw err;
    };
    await expect(callWithFallback(fn, { retries: 3, backoffMs: 1 })).rejects.toBeInstanceOf(RpcError);
    expect(calls).toBe(3);
  });

  test('returns the value on first success', async () => {
    const out = await callWithFallback(async () => 42);
    expect(out).toBe(42);
  });

  test('does not retry non-transient errors', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      const err = new Error('bad arg');
      err.code = 'INVALID_ARGUMENT';
      throw err;
    };
    await expect(callWithFallback(fn, { retries: 3, backoffMs: 1 })).rejects.toBeInstanceOf(RpcError);
    expect(calls).toBe(1);
  });

  test('isTransient classifies errors', () => {
    expect(isTransient({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransient({ code: 'INVALID_ARGUMENT' })).toBe(false);
    expect(isTransient(null)).toBe(false);
  });
});
