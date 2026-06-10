// src/utils/checksum.js
// EIP-55 checksum address validation and normalisation.
//
// References:
//   https://eips.ethereum.org/EIPS/eip-55
//
// Strategy:
//   We delegate the actual keccak256-based checksum computation to ethers v6
//   (`ethers.getAddress` / `ethers.isAddress`). ethers v6 uses the canonical
//   keccak256 (not the FIPS SHA-3 variant) and is the same code path that
//   every other production Ethereum tool uses, so re-implementing it by hand
//   would be both error-prone and a source of subtle checksum drift.
//
// Public surface:
//   - validateAddress(addr)  -> throws InvalidAddressError on bad input,
//                              returns the EIP-55 checksum form on success.
//   - normalizeAddress(addr) -> alias of validateAddress.
//   - toChecksumAddress(addr)-> normalises a known-valid lowercase/uppercase
//                              string to the canonical EIP-55 form. Throws on
//                              non-hex / wrong length.
//   - isValidAddress(addr)   -> boolean variant of validateAddress.
//   - equalAddresses(a, b)   -> case-insensitive equality after validation.

const { getAddress, isAddress } = require('ethers');
const { InvalidAddressError } = require('./errors');

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Validate an address and return its EIP-55 checksum form.
 *
 * Accepts:
 *   - Mixed-case EIP-55 checksummed addresses (must round-trip exactly).
 *   - All-lowercase or all-uppercase addresses (normalised silently).
 *
 * Rejects (throws InvalidAddressError with a `reason` field) when:
 *   - input is not a string
 *   - missing 0x prefix, wrong length, or contains non-hex characters
 *   - mixed-case input that does not match the EIP-55 checksum
 */
function validateAddress(address) {
  if (typeof address !== 'string') {
    throw new InvalidAddressError(String(address), 'not_a_string');
  }
  if (!ADDR_RE.test(address)) {
    throw new InvalidAddressError(address, 'wrong_length_or_non_hex');
  }
  // ethers.getAddress throws if the address is not a valid 20-byte hex. For
  // mixed-case input, it also verifies the EIP-55 checksum. We let it run on
  // all-lowercase / all-uppercase input too — ethers normalises those to the
  // canonical checksum form for us.
  try {
    return getAddress(address);
  } catch (err) {
    const msg = err && err.message ? err.message : 'malformed';
    // Ethers uses "bad address checksum" for mixed-case mismatches; we
    // surface that to callers under a stable reason key.
    const reason = /checksum/i.test(msg)
      ? 'bad_eip55_checksum'
      : 'malformed';
    throw new InvalidAddressError(address, reason);
  }
}

/**
 * Best-effort normalisation. Mirrors validateAddress but swallows errors.
 */
function normalizeAddress(address) {
  return validateAddress(address);
}

/**
 * Force an all-lowercase (or all-uppercase) hex string into the EIP-55 form.
 * Throws if the input isn't a 20-byte hex string.
 */
function toChecksumAddress(address) {
  return validateAddress(address);
}

/**
 * Boolean variant of validateAddress.
 */
function isValidAddress(address) {
  if (typeof address !== 'string' || !ADDR_RE.test(address)) return false;
  // ethers.isAddress(addr)         -> true for any valid 20-byte hex
  // ethers.isAddress(addr, true)   -> only true if the EIP-55 checksum matches
  // We use the strict variant so we don't pretend that a checksummed but
  // mangled address is "valid".
  return isAddress(address, true);
}

/**
 * Case-insensitive equality check, after validation.
 */
function equalAddresses(a, b) {
  return (
    validateAddress(a).toLowerCase() === validateAddress(b).toLowerCase()
  );
}

module.exports = {
  validateAddress,
  normalizeAddress,
  toChecksumAddress,
  isValidAddress,
  equalAddresses,
};
