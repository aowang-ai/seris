import { toolSignal } from '../runtime/toolContext.js';
/**
 * Domain: data-sources — real public market/news/chain data, no API key.
 *
 * Sources:
 *   - Yahoo Finance (public chart endpoint): stocks, ETFs, indices, FX
 *   - DexScreener: DEX pair data across chains (liquidity, price, volume)
 *   - CoinGecko: token search
 *   - CryptoCompare News: latest crypto headlines
 *   - Blockstream.info: Bitcoin transaction lookup
 *   - Cloudflare Ethereum gateway: ETH transaction receipt
 */

import { defineTool, fetchJson, type HarnessTool } from './registry.js';

const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';
const DEXSCREENER = 'https://api.dexscreener.com/latest/dex';
const COINGECKO = 'https://api.coingecko.com/api/v3';
const CRYPTOCOMPARE_NEWS = 'https://min-api.cryptocompare.com/data/v2/news/';
const BLOCKSTREAM = 'https://blockstream.info/api';
const ETH_RPC = 'https://cloudflare-eth.com';

export const getStockSnapshotTool: HarnessTool = defineTool({
  name: 'get_stock_snapshot',
  description:
    'Real-time stock/ETF/index/FX quote via Yahoo Finance (no key): price, change, day range, volume, 52-week range. Works for US (AAPL), indices (^GSPC), FX (EURUSD=X), and crypto (BTC-USD).',
  category: 'market-data',
  parameters: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Ticker: AAPL, TSLA, ^GSPC, EURUSD=X, BTC-USD.' },
    },
    required: ['symbol'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const sym = args.symbol.trim().toUpperCase();
    const r = await fetchJson(`${YAHOO}/${encodeURIComponent(sym)}?interval=1d&range=5d`, {
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    });
    if (!r.ok) return r.error;
    const result = (r.data as { chart?: { result?: Array<Record<string, unknown>> } }).chart?.result?.[0];
    if (!result) return { error: { kind: 'not_found', message: `No Yahoo Finance data for "${sym}".` } };
    const meta = result.meta as Record<string, unknown>;
    return {
      source: 'yahoo-finance',
      symbol: meta.symbol,
      name: meta.shortName ?? meta.longName,
      currency: meta.currency,
      exchange: meta.exchangeName,
      price: meta.regularMarketPrice,
      previousClose: meta.chartPreviousClose ?? meta.previousClose,
      changePct:
        meta.regularMarketPrice && meta.chartPreviousClose
          ? (Number(meta.regularMarketPrice) / Number(meta.chartPreviousClose) - 1) * 100
          : null,
      dayHigh: meta.regularMarketDayHigh,
      dayLow: meta.regularMarketDayLow,
      volume: meta.regularMarketVolume,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
      marketState: meta.marketState,
    };
  },
});

export const getDexTokenSnapshotTool: HarnessTool = defineTool({
  name: 'get_dex_token_snapshot',
  description:
    'DEX market data for a token via DexScreener (no key): best-liquidity pairs across all chains with price, liquidity, 24h volume, price change, DEX name. Input a token contract address or a symbol to search.',
  category: 'market-data',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Token contract address (0x…) or symbol (e.g. WIF, PEPE).' },
    },
    required: ['query'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const q = args.query.trim();
    const isAddress = /^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(q);
    const url = isAddress
      ? `${DEXSCREENER}/tokens/${q}`
      : `${DEXSCREENER}/search?q=${encodeURIComponent(q)}`;
    const r = await fetchJson(url);
    if (!r.ok) return r.error;
    const pairs = ((r.data as { pairs?: Array<Record<string, unknown>> }).pairs ?? [])
      .sort(
        (a, b) =>
          Number((b.liquidity as Record<string, unknown>)?.usd ?? 0) -
          Number((a.liquidity as Record<string, unknown>)?.usd ?? 0),
      )
      .slice(0, 5);
    if (pairs.length === 0) return { error: { kind: 'not_found', message: `No DEX pairs found for "${q}".` } };
    return {
      source: 'dexscreener',
      pairs: pairs.map((p) => ({
        chain: p.chainId,
        dex: p.dexId,
        pair: `${(p.baseToken as Record<string, unknown>)?.symbol}/${(p.quoteToken as Record<string, unknown>)?.symbol}`,
        priceUsd: p.priceUsd,
        liquidityUsd: (p.liquidity as Record<string, unknown>)?.usd,
        volume24hUsd: (p.volume as Record<string, unknown>)?.h24,
        change24hPct: (p.priceChange as Record<string, unknown>)?.h24,
        fdv: p.fdv,
        url: p.url,
      })),
    };
  },
});

export const searchDexTokensTool: HarnessTool = defineTool({
  name: 'search_dex_tokens',
  description: 'Search DEX-traded tokens by name/symbol across all chains (DexScreener), ranked by liquidity.',
  category: 'market-data',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Token name or symbol.' } },
    required: ['query'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const r = await getDexTokenSnapshotTool.execute('inner', { query: args.query });
    return (r as { details?: unknown }).details ?? r;
  },
});

export const lookupTokenTool: HarnessTool = defineTool({
  name: 'lookup_token',
  description: 'Resolve a token name/symbol to its CoinGecko entry: id, symbol, name, market-cap rank. Use before charting to disambiguate.',
  category: 'market-data',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Token name or symbol (e.g. "chainlink", "link").' } },
    required: ['query'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const r = await fetchJson(`${COINGECKO}/search?query=${encodeURIComponent(args.query)}`);
    if (!r.ok) return r.error;
    const coins = ((r.data as { coins?: Array<Record<string, unknown>> }).coins ?? []).slice(0, 10);
    return {
      source: 'coingecko',
      matches: coins.map((c) => ({ id: c.id, symbol: c.symbol, name: c.name, marketCapRank: c.market_cap_rank })),
    };
  },
});

export const searchListedTokensTool: HarnessTool = defineTool({
  name: 'search_listed_tokens',
  description: 'Search centralized-exchange listed tokens (CoinGecko search). Alias of lookup_token for exchange-listed assets.',
  category: 'market-data',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Token name or symbol.' } },
    required: ['query'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const r = await lookupTokenTool.execute('inner', { query: args.query });
    return (r as { details?: unknown }).details ?? r;
  },
});

export const cryptoNewsTool: HarnessTool = defineTool({
  name: 'get_crypto_news',
  description: 'Latest crypto news headlines from CryptoCompare (aggregated from CoinDesk, Cointelegraph, etc.). Optionally filter by coin category.',
  category: 'market-data',
  parameters: {
    type: 'object',
    properties: {
      categories: { type: 'string', description: 'Comma-separated coin categories to filter, e.g. "BTC,ETH" (optional).' },
      limit: { type: 'number', description: 'Number of headlines (default 10, max 50).' },
    },
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const limit = Math.min(Math.max(1, args.limit ?? 10), 50);
    let url = `${CRYPTOCOMPARE_NEWS}?lang=EN`;
    if (args.categories) url += `&categories=${encodeURIComponent(args.categories)}`;
    const key=process.env.CRYPTOCOMPARE_API_KEY;
    const r = await fetchJson(url,{headers:key?{authorization:`Apikey ${key}`}:{}});
    if (!r.ok) return r.error;
    const items = ((r.data as { Data?: Array<Record<string, unknown>> }).Data ?? []).slice(0, limit);
    return {
      source: 'cryptocompare',
      news: items.map((n) => ({
        title: n.title,
        source: n.source,
        publishedAt: n.published_on,
        categories: n.categories,
        url: n.url,
        summary: String(n.body ?? '').slice(0, 200),
      })),
    };
  },
});

async function ethRpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(ETH_RPC, {
    method: 'POST',
    signal: toolSignal(10000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? 'RPC error');
  return j.result;
}

export const getTransactionStatusTool: HarnessTool = defineTool({
  name: 'get_transaction_status',
  description:
    'Look up an on-chain transaction by hash. Auto-detects chain: 0x-prefixed → Ethereum (Cloudflare public RPC); bare hex → Bitcoin (Blockstream). Returns status, block, value, fee.',
  category: 'market-data',
  parameters: {
    type: 'object',
    properties: {
      txHash: { type: 'string', description: 'Transaction hash (0x… for EVM, bare hex for BTC).' },
      chain: { type: 'string', description: 'ethereum | bitcoin (auto-detected if omitted).' },
    },
    required: ['txHash'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const hash = args.txHash.trim();
    const chain = args.chain ?? (hash.startsWith('0x') ? 'ethereum' : 'bitcoin');

    if (chain === 'bitcoin') {
      const r = await fetchJson(`${BLOCKSTREAM}/tx/${hash}`);
      if (!r.ok) return r.error;
      const tx = r.data as Record<string, unknown>;
      const status = tx.status as Record<string, unknown> | undefined;
      const vout = (tx.vout as Array<Record<string, unknown>>) ?? [];
      const totalOut = vout.reduce((s, o) => s + Number(o.value ?? 0), 0);
      return {
        source: 'blockstream',
        chain: 'bitcoin',
        txHash: hash,
        confirmed: status?.confirmed ?? false,
        blockHeight: status?.block_height,
        totalOutputBtc: totalOut / 1e8,
        feeBtc: Number(tx.fee ?? 0) / 1e8,
      };
    }

    try {
      const [receipt, tx] = (await Promise.all([
        ethRpc('eth_getTransactionReceipt', [hash]),
        ethRpc('eth_getTransactionByHash', [hash]),
      ])) as [Record<string, unknown> | null, Record<string, unknown> | null];
      if (!tx) return { error: { kind: 'not_found', message: `Transaction ${hash} not found on Ethereum.` } };
      const valueEth = tx.value ? Number(BigInt(tx.value as string)) / 1e18 : null;
      return {
        source: 'cloudflare-eth-rpc',
        chain: 'ethereum',
        txHash: hash,
        status: receipt ? (receipt.status === '0x1' ? 'success' : 'failed') : 'pending',
        blockNumber: receipt?.blockNumber ? parseInt(receipt.blockNumber as string, 16) : null,
        from: tx.from,
        to: tx.to,
        valueEth,
        gasUsed: receipt?.gasUsed ? parseInt(receipt.gasUsed as string, 16) : null,
      };
    } catch (e) {
      return { error: { kind: 'rpc', message: (e as Error).message } };
    }
  },
});

export const dataSourceTools: HarnessTool[] = [
  getStockSnapshotTool,
  getDexTokenSnapshotTool,
  searchDexTokensTool,
  lookupTokenTool,
  searchListedTokensTool,
  cryptoNewsTool,
  getTransactionStatusTool,
];
