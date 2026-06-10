// tests/utils/checksum.test.js
const {
  validateAddress,
  normalizeAddress,
  toChecksumAddress,
  isValidAddress,
  equalAddresses,
} = require('../../src/utils/checksum');
const { InvalidAddressError } = require('../../src/utils/errors');

// Canonical EIP-55 test vector from https://eips.ethereum.org/EIPS/eip-55
// All-lowercase form -> EIP-55 form.
const EIP55_VECTOR_LOWER = '0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359';
const EIP55_VECTOR_CHECKSUM = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359';
// Vitalik's well-known address, in checksum form.
const VITALIK_LOWER = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const VITALIK_CHECKSUM = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

describe('utils/checksum', () => {
  describe('validateAddress / normalizeAddress', () => {
    test('rejects non-string input', () => {
      expect(() => validateAddress(undefined)).toThrow(InvalidAddressError);
      expect(() => validateAddress(null)).toThrow(InvalidAddressError);
      expect(() => validateAddress(42)).toThrow(InvalidAddressError);
      expect(() => validateAddress('')).toThrow(InvalidAddressError);
    });

    test('rejects missing 0x prefix', () => {
      expect(() => validateAddress('a'.repeat(40))).toThrow(InvalidAddressError);
    });

    test('rejects too-short addresses', () => {
      expect(() => validateAddress('0xabc')).toThrow(InvalidAddressError);
      expect(() => validateAddress('0x' + 'a'.repeat(39))).toThrow(InvalidAddressError);
    });

    test('rejects too-long addresses', () => {
      expect(() => validateAddress('0x' + 'a'.repeat(41))).toThrow(InvalidAddressError);
      expect(() => validateAddress('0x' + 'a'.repeat(100))).toThrow(InvalidAddressError);
    });

    test('rejects non-hex characters', () => {
      expect(() => validateAddress('0x' + 'z'.repeat(40))).toThrow(InvalidAddressError);
      expect(() => validateAddress('0x' + 'G'.repeat(40))).toThrow(InvalidAddressError);
      // Mix of valid hex with one stray char near the end.
      const bad = '0x' + 'a'.repeat(39) + '!';
      expect(() => validateAddress(bad)).toThrow(InvalidAddressError);
    });

    test('rejects bad EIP-55 checksum with a stable reason code', () => {
      // Take a known-good checksummed address and flip one letter that
      // actually contributes to the casing.
      const mangled = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'.replace('B', 'b');
      expect(mangled).not.toBe(EIP55_VECTOR_CHECKSUM);
      let caught = null;
      try {
        validateAddress(mangled);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(InvalidAddressError);
      expect(caught.reason).toBe('bad_eip55_checksum');
    });

    test('accepts the EIP-55 reference vector verbatim', () => {
      expect(validateAddress(EIP55_VECTOR_CHECKSUM)).toBe(EIP55_VECTOR_CHECKSUM);
      expect(validateAddress(VITALIK_CHECKSUM)).toBe(VITALIK_CHECKSUM);
    });

    test('normalises all-lowercase to the EIP-55 checksum form', () => {
      const out = normalizeAddress(EIP55_VECTOR_LOWER);
      expect(out).toBe(EIP55_VECTOR_CHECKSUM);
      expect(out).not.toBe(EIP55_VECTOR_LOWER);
    });

    test('normalises all-uppercase to the EIP-55 checksum form', () => {
      const upper = '0x' + EIP55_VECTOR_LOWER.slice(2).toUpperCase();
      const out = normalizeAddress(upper);
      expect(out).toBe(EIP55_VECTOR_CHECKSUM);
    });

    test('the .address and .reason fields on InvalidAddressError are populated', () => {
      try {
        validateAddress('0xzzz');
      } catch (e) {
        expect(e).toBeInstanceOf(InvalidAddressError);
        expect(e.address).toBe('0xzzz');
        expect(typeof e.reason).toBe('string');
        expect(e.reason.length).toBeGreaterThan(0);
        return;
      }
      throw new Error('expected validateAddress to throw');
    });
  });

  describe('toChecksumAddress', () => {
    test('is an alias of validateAddress for valid input', () => {
      expect(toChecksumAddress(EIP55_VECTOR_LOWER)).toBe(EIP55_VECTOR_CHECKSUM);
    });

    test('throws on bad input', () => {
      expect(() => toChecksumAddress('0xbad')).toThrow(InvalidAddressError);
    });
  });

  describe('isValidAddress', () => {
    test('returns true for a properly checksummed address', () => {
      expect(isValidAddress(EIP55_VECTOR_CHECKSUM)).toBe(true);
      expect(isValidAddress(VITALIK_CHECKSUM)).toBe(true);
    });

    test('returns true for an all-lowercase hex string', () => {
      // All-lowercase is a valid 20-byte hex; isValidAddress should treat
      // it as a "yes, this is an address we can normalise" — not strict.
      expect(isValidAddress(EIP55_VECTOR_LOWER)).toBe(true);
    });

    test('returns false for a bad checksum', () => {
      // Flip a casing character in the checksummed form.
      const mangled = EIP55_VECTOR_CHECKSUM.replace('B', 'b');
      expect(isValidAddress(mangled)).toBe(false);
    });

    test('returns false for malformed input', () => {
      expect(isValidAddress('0xabc')).toBe(false);
      expect(isValidAddress('not an address')).toBe(false);
      expect(isValidAddress(null)).toBe(false);
      expect(isValidAddress(undefined)).toBe(false);
      expect(isValidAddress(42)).toBe(false);
      expect(isValidAddress('0x' + 'z'.repeat(40))).toBe(false);
    });
  });

  describe('equalAddresses', () => {
    test('treats the same address in different cases as equal', () => {
      const a = EIP55_VECTOR_CHECKSUM;
      const b = EIP55_VECTOR_LOWER;
      const c = '0x' + EIP55_VECTOR_LOWER.slice(2).toUpperCase();
      expect(equalAddresses(a, b)).toBe(true);
      expect(equalAddresses(a, c)).toBe(true);
      expect(equalAddresses(b, c)).toBe(true);
    });

    test('returns false for different addresses', () => {
      expect(equalAddresses(EIP55_VECTOR_CHECKSUM, VITALIK_CHECKSUM)).toBe(false);
    });

    test('throws if either side is malformed', () => {
      expect(() => equalAddresses('0xabc', VITALIK_CHECKSUM)).toThrow(InvalidAddressError);
      expect(() => equalAddresses(VITALIK_CHECKSUM, '0xabc')).toThrow(InvalidAddressError);
    });
  });
});
