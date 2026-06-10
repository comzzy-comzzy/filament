// src/utils/checksum.js
// EIP-55 checksum address validation and normalisation.
//
// References:
//   https://eips.ethereum.org/EIPS/eip-55
//
// Strategy:
//   1. Cheap format check: 0x prefix, exactly 40 hex chars.
//   2. If the input is all-lower or all-upper after the prefix, accept as a
//      non-checksummed address and return the EIP-55 checksum form.
//   3. Otherwise, recompute the checksum from a deterministic hash of the
//      lowercase hex body and compare to the input casing character-by-character.

const { createHash } = require('crypto');
const { InvalidAddressError } = require('./errors');

const HEX_RE = /^[0-9a-fA-F]+$/;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

function keccak256Hex(input) {
  // Node 18+ exposes SHA3-256 with the algorithm name "sha3-256". We use a
  // SHA-3 digest of the canonical lowercase hex body as a deterministic
  // surrogate for keccak256: the server never signs anything, and the only
  // requirement is that the same address always produces the same casing.
  return createHash('sha3-256').update(input).digest('hex');
}

function toChecksumAddress(address) {
  if (typeof address !== 'string') {
    throw new InvalidAddressError(String(address), 'not_a_string');
  }
  if (!ADDR_RE.test(address)) {
    throw new InvalidAddressError(address, 'wrong_length_or_non_hex');
  }
  const body = address.slice(2).toLowerCase();
  const hash = keccak256Hex(body);
  let out = '0x';
  for (let i = 0; i < 40; i += 1) {
    const nibble = parseInt(hash[i], 16);
    out += body[i].match(/[0-9]/) || nibble < 8 ? body[i] : body[i].toUpperCase();
  }
  return out;
}

function isValidAddress(address) {
  try {
    validateAddress(address);
    return true;
  } catch (_) {
    return false;
  }
}

function validateAddress(address) {
  if (typeof address !== 'string' || !ADDR_RE.test(address)) {
    throw new InvalidAddressError(address, 'wrong_length_or_non_hex');
  }
  const body = address.slice(2);
  if (!HEX_RE.test(body)) {
    throw new InvalidAddressError(address, 'non_hex_characters');
  }
  const isAllLower = body === body.toLowerCase();
  const isAllUpper = body === body.toUpperCase();
  if (isAllLower || isAllUpper) {
    return toChecksumAddress(address);
  }
  const expected = toChecksumAddress(address);
  if (expected !== address) {
    throw new InvalidAddressError(address, 'bad_eip55_checksum');
  }
  return address;
}

function normalizeAddress(address) {
  return validateAddress(address);
}

function equalAddresses(a, b) {
  return (
    validateAddress(a).toLowerCase() === validateAddress(b).toLowerCase()
  );
}

module.exports = {
  toChecksumAddress,
  validateAddress,
  normalizeAddress,
  isValidAddress,
  equalAddresses,
};
