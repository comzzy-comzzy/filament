// src/utils/errors.js
// Typed error classes used across Filament. Keeping them small and named lets
// callers pattern-match on `err.name` without sniffing arbitrary messages.

class FilamentError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'FilamentError';
    if (cause) this.cause = cause;
  }
}

class InvalidAddressError extends FilamentError {
  constructor(address, reason = 'malformed') {
    super(`Invalid EVM address: ${address} (${reason})`);
    this.name = 'InvalidAddressError';
    this.address = address;
    this.reason = reason;
  }
}

class RpcError extends FilamentError {
  constructor(message, { cause, chain = null, attempts = 0 } = {}) {
    super(message, { cause });
    this.name = 'RpcError';
    this.chain = chain;
    this.attempts = attempts;
  }
}

class RateLimitError extends FilamentError {
  constructor(waitMs) {
    super(`Rate limit hit; retry after ${waitMs}ms`);
    this.name = 'RateLimitError';
    this.waitMs = waitMs;
  }
}

class SchemaError extends FilamentError {
  constructor(tool, detail) {
    super(`Invalid input for ${tool}: ${detail}`);
    this.name = 'SchemaError';
    this.tool = tool;
    this.detail = detail;
  }
}

module.exports = {
  FilamentError,
  InvalidAddressError,
  RpcError,
  RateLimitError,
  SchemaError,
};
