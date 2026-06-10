// tests/utils/checksum.test.js
const {
  validateAddress,
  normalizeAddress,
  toChecksumAddress,
  isValidAddress,
  equalAddresses,
} = require('../../src/utils/checksum');
const { InvalidAddressError } = require('../../src/utils/errors');

describe('utils/checksum', () => {
  test('rejects too-short addresses', () => {
    expect(() => validateAddress('0xabc')).toThrow(InvalidAddressError);
  });

  test('rejects non-hex characters', () => {
    expect(() => validateAddress('0x' + 'z'.repeat(40))).toThrow(InvalidAddressError);
  });

  test('rejects an all-zero garbage address with bad casing', () => {
    // Build a body, compute its EIP-55 checksum, then flip the case of
    // one hex character that is non-numeric — this guarantees a
    // checksum mismatch.
    const body = '1234567890abcdef1234567890abcdef12345678';
    const checksummed = toChecksumAddress('0x' + body);
    // Find the first uppercase letter in the checksum body and flip it.
    const bodyNoPrefix = checksummed.slice(2);
    const idx = bodyNoPrefix.split('').findIndex((c) => c >= 'A' && c <= 'F');
    expect(idx).toBeGreaterThanOrEqual(0);
    const flippedChar = bodyNoPrefix[idx] === 'A' ? 'B' : 'A';
    const mangled = '0x' + bodyNoPrefix.slice(0, idx) + flippedChar + bodyNoPrefix.slice(idx + 1);
    expect(mangled).not.toBe(checksummed);
    expect(() => validateAddress(mangled)).toThrow(InvalidAddressError);
  });

  test('normalises all-lowercase to the EIP-55 checksum form', () => {
    const lower = '0x' + 'a'.repeat(40);
    const out = normalizeAddress(lower);
    expect(out).toBe(toChecksumAddress(lower));
    expect(out).not.toBe(lower);
  });

  test('equalAddresses is case-insensitive', () => {
    const a = '0x' + 'A'.repeat(40);
    const b = '0x' + 'a'.repeat(40);
    expect(equalAddresses(a, b)).toBe(true);
  });
});
