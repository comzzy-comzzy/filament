// src/rpc/fetchers.js
// Onchain data fetchers. The heuristics in src/heuristics/* are pure
// scorers that operate on pre-computed bags of data; this module is what
// actually walks the chain to fill those bags.
//
// All fetchers:
//   * Honour ctx.rateLimit (serial gate, one outbound call at a time).
//   * Read-through / write-through ctx.cache (TTL-based).
//   * Tolerate transient failures by returning empty arrays/objects so
//     individual tool failures don't poison the whole result.
//   * Are bounded by HISTORY_BLOCKS / MAX_LOGS_PER_CHAIN / MAX_GAS_SAMPLES
//     to keep latency predictable and RPC credit use bounded.
//
// History depth:
//   The default is the last 1,000,000 blocks (~5–6 months on Ethereum).
//   Override with the HISTORY_BLOCKS env var. Set to 0 to scan from
//   genesis (slow, heavy on rate-limit budget — only use for power users).

'use strict';

const { isAddress, zeroPadValue, toBeHex } = require('ethers');
const { callWithFallback } = require('./fallback');

// keccak256("Transfer(address,address,uint256)")
const TOPICS = Object.freeze({
  TRANSFER: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
});

// Curated high-traffic token contracts per chain. These are the tokens
// that, in practice, account for >80% of all onchain transfer activity.
// We MUST provide an `address` filter to getLogs because virtually every
// public RPC rejects topic-only queries (Cloudflare returns
// -32046 "Cannot fulfill request", publicnode returns
// -32701 "specify an address or order a full node"). This is the reason
// the previous version of this file returned zero signal for every
// wallet — the call was being rejected before any data was retrieved.
const KNOWN_TOKENS = Object.freeze({
  ethereum: [
    { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC' },
    { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT' },
    { address: '0x6b175474e89094c44da98b954eedeac495271d0f', symbol: 'DAI' },
    { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', symbol: 'WETH' },
    { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', symbol: 'WBTC' },
    { address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', symbol: 'stETH' },
    { address: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0', symbol: 'MATIC' },
    { address: '0x514910771af9ca656af840dff83e8264ecf986ca', symbol: 'LINK' },
    { address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', symbol: 'UNI' },
    { address: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', symbol: 'SHIB' },
    { address: '0x4e15361fd6b4bb609fa63c81a2be19d873717870', symbol: 'FCT' },
    { address: '0xdefa4e8a7bcba345f687a2f1456f5edd9ce97202', symbol: 'KNCL' },
  ],
  arbitrum: [
    { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC' },
    { address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', symbol: 'USDT' },
    { address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', symbol: 'DAI' },
    { address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', symbol: 'WETH' },
    { address: '0x2f2a2543b76a4166549f7aa3142ef1142518080d', symbol: 'WBTC' },
    { address: '0x912ce59144191c1204e64559fe8253a0e49e6548', symbol: 'ARB' },
    { address: '0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a', symbol: 'GMX' },
    { address: '0x539bde0d7dbd336b79148aa742883198bbf60342', symbol: 'MAGIC' },
    { address: '0x1622bf67e6e5747b32c3cf62239daee622a06b5e', symbol: 'LPT' },
  ],
  optimism: [
    { address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', symbol: 'USDC' },
    { address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', symbol: 'USDT' },
    { address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', symbol: 'DAI' },
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH' },
    { address: '0x68f180fcce6836688e9084f035309e29bf0a2095', symbol: 'WBTC' },
    { address: '0x4200000000000000000000000000000000000042', symbol: 'OP' },
    { address: '0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6', symbol: 'SNX' },
  ],
  base: [
    { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC' },
    { address: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', symbol: 'USDT' },
    { address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', symbol: 'DAI' },
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH' },
    { address: '0x0555e30da8f98308edb960aa94c0db47230d2b9c', symbol: 'WBTC' },
    { address: '0x940181a94a35a4569e4529a3cdfb74e38fd98631', symbol: 'AERO' },
  ],
  polygon: [
    { address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', symbol: 'USDC' },
    { address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', symbol: 'USDT' },
    { address: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', symbol: 'DAI' },
    { address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', symbol: 'WMATIC' },
    { address: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', symbol: 'WETH' },
    { address: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', symbol: 'WBTC' },
    { address: '0x0000000000000000000000000000000000001010', symbol: 'MATIC' },
  ],
  bnb: [
    { address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', symbol: 'USDC' },
    { address: '0x55d398326f99059ff775485246999027b3197955', symbol: 'USDT' },
    { address: '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3', symbol: 'DAI' },
    { address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', symbol: 'WBNB' },
    { address: '0x2170ed0880ac9a755fd29b2688956bd959f933f8', symbol: 'WETH' },
    { address: '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c', symbol: 'WBTC' },
    { address: '0x55d398326f99059ff775485246999027b3197955', symbol: 'BUSD' },
  ],
  mantle: [
    { address: '0x09bc4e0d864854c6afb6e9e9aaabf9480059275b', symbol: 'USDC' },
    { address: '0x201eba5cc46d216ce6dc03f80a0ea35a1d6655ee', symbol: 'USDT' },
    { address: '0xdeaddeaddeaddeaddeaddeaddeaddeaddead1111', symbol: 'WETH' },
    { address: '0x78c1b0c331c9a4c9d4bf9e09c83ce1fa48b39e00', symbol: 'WMNT' },
  ],
});

// Curated high-traffic token contracts per chain. These are the tokens
// that, in practice, account for >80% of all onchain transfer activity.
// We MUST provide an `address` filter to getLogs because virtually every
// public RPC rejects topic-only queries (Cloudflare returns
// -32046 "Cannot fulfill request", publicnode returns
// -32701 "specify an address or order a full node"). This is the reason
// the previous version of this file returned zero signal for every
// wallet — the call was being rejected before any data was retrieved.
const KNOWN_TOKENS = Object.freeze({
  ethereum: [
    { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC' },
    { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT' },
    { address: '0x6b175474e89094c44da98b954eedeac495271d0f', symbol: 'DAI' },
    { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', symbol: 'WETH' },
    { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', symbol: 'WBTC' },
    { address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', symbol: 'stETH' },
    { address: '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0', symbol: 'MATIC' },
    { address: '0x514910771af9ca656af840dff83e8264ecf986ca', symbol: 'LINK' },
    { address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', symbol: 'UNI' },
    { address: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', symbol: 'SHIB' },
    { address: '0x4e15361fd6b4bb609fa63c81a2be19d873717870', symbol: 'FCT' },
    { address: '0xdefa4e8a7bcba345f687a2f1456f5edd9ce97202', symbol: 'KNCL' },
  ],
  arbitrum: [
    { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC' },
    { address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', symbol: 'USDT' },
    { address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', symbol: 'DAI' },
    { address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', symbol: 'WETH' },
    { address: '0x2f2a2543b76a4166549f7aa3142ef1142518080d', symbol: 'WBTC' },
    { address: '0x912ce59144191c1204e64559fe8253a0e49e6548', symbol: 'ARB' },
    { address: '0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a', symbol: 'GMX' },
    { address: '0x539bde0d7dbd336b79148aa742883198bbf60342', symbol: 'MAGIC' },
    { address: '0x1622bf67e6e5747b32c3cf62239daee622a06b5e', symbol: 'LPT' },
  ],
  optimism: [
    { address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', symbol: 'USDC' },
    { address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', symbol: 'USDT' },
    { address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', symbol: 'DAI' },
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH' },
    { address: '0x68f180fcce6836688e9084f035309e29bf0a2095', symbol: 'WBTC' },
    { address: '0x4200000000000000000000000000000000000042', symbol: 'OP' },
    { address: '0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6', symbol: 'SNX' },
  ],
  base: [
    { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC' },
    { address: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', symbol: 'USDT' },
    { address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', symbol: 'DAI' },
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH' },
    { address: '0x0555e30da8f98308edb960aa94c0db47230d2b9c', symbol: 'WBTC' },
    { address: '0x940181a94a35a4569e4529a3cdfb74e38fd98631', symbol: 'AERO' },
  ],
  polygon: [
    { address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', symbol: 'USDC' },
    { address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', symbol: 'USDT' },
    { address: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', symbol: 'DAI' },
    { address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', symbol: 'WMATIC' },
    { address: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', symbol: 'WETH' },
    { address: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', symbol: 'WBTC' },
    { address: '0x0000000000000000000000000000000000001010', symbol: 'MATIC' },
  ],
  bnb: [
    { address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', symbol: 'USDC' },
    { address: '0x55d398326f99059ff775485246999027b3197955', symbol: 'USDT' },
    { address: '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3', symbol: 'DAI' },
    { address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', symbol: 'WBNB' },
    { address: '0x2170ed0880ac9a755fd29b2688956bd959f933f8', symbol: 'WETH' },
    { address: '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c', symbol: 'WBTC' },
    { address: '0x55d398326f99059ff775485246999027b3197955', symbol: 'BUSD' },
  ],
  mantle: [
    { address: '0x09bc4e0d864854c6afb6e9e9aaabf9480059275b', symbol: 'USDC' },
    { address: '0x201eba5cc46d216ce6dc03f80a0ea35a1d6655ee', symbol: 'USDT' },
    { address: '0xdeaddeaddeaddeaddeaddeaddeaddeaddead1111', symbol: 'WETH' },
    { address: '0x78c1b0c331c9a4c9d4bf9e09c83ce1fa48b39e00', symbol: 'WMNT' },
  ],
});

const DEFAULT_OPTS = Object.freeze({
  historyBlocks: Number(process.env.HISTORY_BLOCKS || 1_000_000),
  // Most public RPCs cap getLogs at 5k–10k blocks per call.
  maxLogBlockRange: Number(process.env.MAX_LOG_BLOCK_RANGE || 100_000),
  // Per-chain cap on logs to keep memory + heuristic runtime bounded.
  maxLogsPerChain: Number(process.env.MAX_LOGS_PER_CHAIN || 5_000),
  // Distinct edges returned to heuristics.
  maxEdges: Number(process.env.MAX_EDGES || 2_000),
  // Distinct contracts returned to contract-overlap heuristic.
  maxContracts: Number(process.env.MAX_CONTRACTS || 500),
  // Cap distinct blocks we hydrate timestamps for.
  maxBlockLookups: Number(process.env.MAX_BLOCK_LOOKUPS || 200),
  // Gas samples to fetch.
  maxGasSamples: Number(process.env.MAX_GAS_SAMPLES || 25),
  // Cache TTL for fetcher results.
  cacheTtlSeconds: Number(process.env.FETCHER_CACHE_TTL || 300),
});

function lower(addr) {
  return String(addr).toLowerCase();
}

function padAddr(addr) {
  // Use zeroPadValue(toBeHex(...), 32) so the topic is 32 bytes wide.
  // We intentionally accept a lowercase / mixed-case string and skip the
  // EIP-55 checksum round-trip — the indexed topic only matches the
  // lowercased address bytes anyway.
  const hex = toBeHex('0x' + String(addr).toLowerCase().replace(/^0x/, ''));
  return zeroPadValue(hex, 32);
}

function isProviderLive(provider) {
  return Boolean(provider && typeof provider.getBlockNumber === 'function');
}

function topicSlots(arr) {
  return arr.map((t) => (t == null ? null : t));
}

async function rateLimitCall(ctx, fn, chain) {
  if (ctx && ctx.rateLimit && typeof ctx.rateLimit.run === 'function') {
    return ctx.rateLimit.run(() => callWithFallback(fn, { chain }));
  }
  return callWithFallback(fn);
}

function cacheGet(ctx, key) {
  if (ctx && ctx.cache && typeof ctx.cache.get === 'function') {
    return ctx.cache.get(key);
  }
  return undefined;
}

function cacheSet(ctx, key, value) {
  if (ctx && ctx.cache && typeof ctx.cache.set === 'function') {
    ctx.cache.set(key, value, { ttlMs: DEFAULT_OPTS.cacheTtlSeconds * 1000 });
  }
}

// ---------------------------------------------------------------------------
// Block window
// ---------------------------------------------------------------------------

async function blockWindow(ctx, chain) {
  const provider = ctx.getProvider(chain);
  if (!isProviderLive(provider)) return { fromBlock: 0, toBlock: 0, head: 0 };
  const cacheKey = `blockWindow:${chain}`;
  const cached = cacheGet(ctx, cacheKey);
  if (cached) return cached;
  const head = await rateLimitCall(ctx, () => provider.getBlockNumber(), chain);
  const win = {
    fromBlock: Math.max(0, head - DEFAULT_OPTS.historyBlocks),
    toBlock: head,
    head,
  };
  cacheSet(ctx, cacheKey, win);
  return win;
}

// paginatedLogs — slice [from, to] into chunks the RPC will accept,
// fetch each chunk serially through the rate limiter, concat.
// Returns the merged log array (capped at maxLogsPerChain).
async function paginatedLogs(ctx, provider, baseFilter, chain) {
  const { fromBlock, toBlock } = baseFilter;
  if (fromBlock > toBlock) return [];
  const step = Math.max(1, DEFAULT_OPTS.maxLogBlockRange);
  const out = [];
  for (let start = fromBlock; start <= toBlock; start += step) {
    const end = Math.min(toBlock, start + step - 1);
    const filter = { ...baseFilter, fromBlock: start, toBlock: end };
    let chunk = [];
    try {
      chunk = await rateLimitCall(ctx, () => provider.getLogs(filter), chain);
    } catch (_) {
      chunk = [];
    }
    if (Array.isArray(chunk) && chunk.length > 0) {
      out.push(...chunk);
      if (out.length >= DEFAULT_OPTS.maxLogsPerChain) {
        out.length = DEFAULT_OPTS.maxLogsPerChain;
        return out;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block-timestamp hydration
// ---------------------------------------------------------------------------

async function fetchTimestamps(ctx, chain, blockNumbers) {
  const out = {};
  const seen = new Set();
  const missing = [];
  for (const bn of blockNumbers) {
    if (bn == null) continue;
    if (seen.has(bn)) continue;
    seen.add(bn);
    const cacheKey = `block:${chain}:${bn}`;
    const cached = cacheGet(ctx, cacheKey);
    if (cached !== undefined && cached !== null) {
      out[bn] = cached;
    } else {
      missing.push(bn);
    }
  }
  if (missing.length === 0) return out;

  const provider = ctx.getProvider(chain);
  if (!isProviderLive(provider)) return out;
  // Hydrate at most maxBlockLookups unique blocks per call to bound cost.
  const slice = missing.slice(0, DEFAULT_OPTS.maxBlockLookups);
  for (const bn of slice) {
    try {
      const block = await rateLimitCall(ctx, () => provider.getBlock(bn), chain);
      if (block && block.timestamp) {
        const ts = Number(block.timestamp);
        out[bn] = ts;
        cacheSet(ctx, `block:${chain}:${bn}`, ts);
      }
    } catch (_) {
      // ignore
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. EOA activity: ERC20 Transfer events touching the wallet.
// ---------------------------------------------------------------------------

async function fetchEOAActivity(ctx, chain, wallet) {
  if (!wallet || !isAddress(wallet)) {
    return {
      chain,
      wallet: lower(wallet || ''),
      txHashes: new Set(),
      counterparties: new Map(),
      fundingEdges: [],
      contractCounts: new Map(),
      lastBlock: 0,
      error: 'invalid_address',
    };
  }
  const provider = ctx.getProvider(chain);
  if (!isProviderLive(provider)) {
    return {
      chain,
      wallet: lower(wallet),
      txHashes: new Set(),
      counterparties: new Map(),
      fundingEdges: [],
      contractCounts: new Map(),
      lastBlock: 0,
      error: 'no_provider',
    };
  }
  const cacheKey = `eoaActivity:${chain}:${lower(wallet)}`;
  const cached = cacheGet(ctx, cacheKey);
  if (cached) return cached;

  const win = await blockWindow(ctx, chain);
  const padded = padAddr(wallet);
  const txHashes = new Set();
  const fundingEdges = [];
  const counterpartyCounts = new Map();
  const contractCounts = new Map();
  let lastBlock = 0;
  let lastLogIndex = -1;

  try {
    const sent = await paginatedLogs(
      ctx,
      provider,
      {
        topics: topicSlots([TOPICS.TRANSFER, padded, null, null]),
        fromBlock: win.fromBlock,
        toBlock: win.toBlock,
      },
      chain,
    );
    const recv = await paginatedLogs(
      ctx,
      provider,
      {
        topics: topicSlots([TOPICS.TRANSFER, null, padded, null]),
        fromBlock: win.fromBlock,
        toBlock: win.toBlock,
      },
      chain,
    );

    const all = sent.concat(recv);
    for (const log of all) {
      if (!log || !log.topics || log.topics.length < 3) continue;
      const from = '0x' + String(log.topics[1]).slice(-40);
      const to = '0x' + String(log.topics[2]).slice(-40);
      if (lower(from) !== lower(wallet) && lower(to) !== lower(wallet)) continue;
      txHashes.add(log.transactionHash);
      const tokenContract = lower(log.address || '');
      const logIndex =
        typeof log.index === 'string' ? parseInt(log.index, 16) : log.index || 0;
      fundingEdges.push({
        from: lower(from),
        to: lower(to),
        chain,
        hash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex,
        tokenContract,
        value: 0,
      });
      if (
        log.blockNumber > lastBlock ||
        (log.blockNumber === lastBlock && logIndex > lastLogIndex)
      ) {
        lastBlock = log.blockNumber;
        lastLogIndex = logIndex;
      }
      counterpartyCounts.set(
        lower(to) === lower(wallet) ? lower(from) : lower(to),
        (counterpartyCounts.get(
          lower(to) === lower(wallet) ? lower(from) : lower(to),
        ) || 0) + 1,
      );
      contractCounts.set(tokenContract, (contractCounts.get(tokenContract) || 0) + 1);
    }
  } catch (err) {
    return {
      chain,
      wallet: lower(wallet),
      txHashes: new Set(),
      counterparties: new Map(),
      fundingEdges: [],
      contractCounts: new Map(),
      lastBlock: 0,
      error: err && err.message ? err.message : 'rpc_error',
    };
  }

  const out = {
    chain,
    wallet: lower(wallet),
    txHashes,
    counterparties: counterpartyCounts,
    fundingEdges: fundingEdges.slice(0, DEFAULT_OPTS.maxEdges),
    contractCounts,
    lastBlock,
    error: null,
  };
  cacheSet(ctx, cacheKey, out);
  return out;
}

// ---------------------------------------------------------------------------
// 2. Bridge interactions
// ---------------------------------------------------------------------------

async function fetchBridgeInteractions(ctx, chain, wallet) {
  if (!wallet || !isAddress(wallet)) return [];
  const provider = ctx.getProvider(chain);
  if (!isProviderLive(provider)) return [];

  let BRIDGES;
  try {
    BRIDGES = require('../config/bridges').BRIDGES;
  } catch (_) {
    return [];
  }

  const padded = padAddr(wallet);
  const win = await blockWindow(ctx, chain);
  const out = [];

  for (const bridgeName of Object.keys(BRIDGES)) {
    const bridge = BRIDGES[bridgeName];
    const address =
      (bridge.chains && bridge.chains[chain]) ||
      (bridge.endpointByChain && bridge.endpointByChain[chain]);
    if (!address) continue;
    const cacheKey = `bridge:${chain}:${bridgeName}:${lower(wallet)}`;
    const cached = cacheGet(ctx, cacheKey);
    if (cached) {
      if (Array.isArray(cached) && cached.length > 0) out.push(...cached);
      continue;
    }
    let logs = [];
    try {
      logs = await paginatedLogs(
        ctx,
        provider,
        {
          address: lower(address),
          topics: [null, padded, null, null],
          fromBlock: win.fromBlock,
          toBlock: win.toBlock,
        },
        chain,
      );
    } catch (_) {
      logs = [];
    }
    const hits = (logs || []).map((log) => ({
      from: lower(wallet),
      to: lower(wallet),
      fromChain: chain,
      toChain: chain,
      bridge: bridgeName,
      hash: log.transactionHash,
      blockNumber: log.blockNumber,
      timestamp: 0,
      amount: 0,
    }));
    cacheSet(ctx, cacheKey, hits);
    if (hits.length > 0) out.push(...hits);
  }
  return out.slice(0, DEFAULT_OPTS.maxEdges);
}

// ---------------------------------------------------------------------------
// 3. Gas samples
// ---------------------------------------------------------------------------

async function fetchGasSamples(ctx, chain, txHashes) {
  const provider = ctx.getProvider(chain);
  if (!isProviderLive(provider) || !Array.isArray(txHashes) || txHashes.length === 0) {
    return [];
  }
  const samples = [];
  const seen = new Set();
  for (const hash of txHashes) {
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    if (samples.length >= DEFAULT_OPTS.maxGasSamples) break;
    const cacheKey = `tx:${chain}:${hash}`;
    const cached = cacheGet(ctx, cacheKey);
    if (cached && cached.skipped) continue;
    let tx = cached;
    let receipt = null;
    if (!tx) {
      try {
        tx = await rateLimitCall(ctx, () => provider.getTransaction(hash), chain);
      } catch (_) {
        tx = null;
      }
    }
    if (!tx) {
      cacheSet(ctx, cacheKey, { skipped: true });
      continue;
    }
    try {
      receipt = await rateLimitCall(ctx, () => provider.getTransactionReceipt(hash), chain);
    } catch (_) {
      receipt = null;
    }
    cacheSet(ctx, cacheKey, tx);

    // EIP-1559 fields preferred; fall back to legacy gasPrice.
    const gasPriceGwei = tx.gasPrice != null ? Number(tx.gasPrice) / 1e9 : 0;
    const maxFeeGwei =
      tx.maxFeePerGas != null ? Number(tx.maxFeePerGas) / 1e9 : gasPriceGwei;
    const maxPriorityGwei =
      tx.maxPriorityFeePerGas != null ? Number(tx.maxPriorityFeePerGas) / 1e9 : 0;
    const baseFee = receipt && receipt.gasUsed ? maxFeeGwei - maxPriorityGwei : maxFeeGwei;
    const tip = maxPriorityGwei;
    const limit = tx.gasLimit != null ? Number(tx.gasLimit) / 1e9 : 0;
    samples.push({ baseFee, tip, limit });
  }
  return samples;
}

// ---------------------------------------------------------------------------
// 4. Contract interactions (used by contract_interaction_overlap)
// ---------------------------------------------------------------------------

async function fetchContractInteractions(ctx, chain, wallet) {
  if (!wallet || !isAddress(wallet)) return [];
  const provider = ctx.getProvider(chain);
  if (!isProviderLive(provider)) return [];

  const cacheKey = `contracts:${chain}:${lower(wallet)}`;
  const cached = cacheGet(ctx, cacheKey);
  if (cached) return cached;

  const win = await blockWindow(ctx, chain);
  const padded = padAddr(wallet);
  const counter = new Map();

  try {
    const sentLogs = await paginatedLogs(
      ctx,
      provider,
      {
        topics: topicSlots([null, padded, null, null]),
        fromBlock: win.fromBlock,
        toBlock: win.toBlock,
      },
      chain,
    );
    const recvLogs = await paginatedLogs(
      ctx,
      provider,
      {
        topics: topicSlots([null, null, padded, null]),
        fromBlock: win.fromBlock,
        toBlock: win.toBlock,
      },
      chain,
    );
    const seen = new Set();
    for (const log of sentLogs.concat(recvLogs)) {
      if (!log || !log.address) continue;
      const key = lower(log.address);
      if (seen.has(key)) continue;
      seen.add(key);
      counter.set(key, (counter.get(key) || 0) + 1);
    }
  } catch (_) {
    return [];
  }

  const out = Array.from(counter.entries())
    .map(([address, count]) => ({ address, count, obscure: count < 200 }))
    .slice(0, DEFAULT_OPTS.maxContracts);
  cacheSet(ctx, cacheKey, out);
  return out;
}

// ---------------------------------------------------------------------------
// 5. Deployments
// ---------------------------------------------------------------------------

async function fetchDeployments(ctx, chain, wallet) {
  if (!wallet || !isAddress(wallet)) return [];
  const provider = ctx.getProvider(chain);
  if (!isProviderLive(provider)) return [];
  const cacheKey = `deployments:${chain}:${lower(wallet)}`;
  const cached = cacheGet(ctx, cacheKey);
  if (cached !== undefined) return cached;

  const win = await blockWindow(ctx, chain);
  const padded = padAddr(wallet);
  try {
    // Look for any log with the wallet in the first indexed slot. This
    // catches factory-deployed contracts where the deployer is in
    // topic[1] (e.g. Create2 factory). It won't catch plain CREATE
    // deployments, but those are visible via the receipts path below.
    const logs = await paginatedLogs(
      ctx,
      provider,
      {
        topics: topicSlots([null, padded, null, null]),
        fromBlock: win.fromBlock,
        toBlock: win.toBlock,
      },
      chain,
    );
    const seen = new Set();
    const out = [];
    for (const log of logs) {
      if (!log || !log.address) continue;
      const key = lower(log.address);
      if (seen.has(key)) continue;
      seen.add(key);
      let bytecode = null;
      try {
        bytecode = await rateLimitCall(ctx, () => provider.getCode(log.address), chain);
      } catch (_) {
        bytecode = null;
      }
      if (bytecode && bytecode !== '0x') {
        out.push({ chain, contractAddress: key, bytecode });
      }
      if (out.length >= 200) break;
    }
    cacheSet(ctx, cacheKey, out);
    return out;
  } catch (_) {
    cacheSet(ctx, cacheKey, []);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 6. Cluster expansion (for the eoa_cluster_graph heuristic, depth > 1)
// ---------------------------------------------------------------------------

async function expandCluster(ctx, chain, wallet, depth, fundingEdges) {
  if (!fundingEdges || fundingEdges.length === 0 || !wallet || depth <= 1) {
    return fundingEdges;
  }
  const walletLow = lower(wallet);
  const peers = new Set();
  for (const e of fundingEdges) {
    if (e.from === walletLow) peers.add(e.to);
    else if (e.to === walletLow) peers.add(e.from);
  }
  if (peers.size === 0 || peers.size > 50) return fundingEdges;

  const expanded = fundingEdges.slice();
  const seenHashes = new Set(expanded.map((e) => e.hash));
  for (const peer of peers) {
    try {
      const peerActivity = await fetchEOAActivity(ctx, chain, peer);
      for (const edge of peerActivity.fundingEdges) {
        if (seenHashes.has(edge.hash)) continue;
        seenHashes.add(edge.hash);
        expanded.push(edge);
        if (expanded.length >= DEFAULT_OPTS.maxEdges) break;
      }
    } catch (_) {
      // ignore
    }
    if (expanded.length >= DEFAULT_OPTS.maxEdges) break;
  }
  return expanded;
}

module.exports = {
  TOPICS,
  DEFAULT_OPTS,
  blockWindow,
  paginatedLogs,
  fetchEOAActivity,
  fetchTimestamps,
  fetchGasSamples,
  fetchBridgeInteractions,
  fetchContractInteractions,
  fetchDeployments,
  expandCluster,
};
