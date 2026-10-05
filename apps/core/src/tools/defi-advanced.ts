/**
 * Domain: defi-advanced — deeper real DeFi / perp / macro data, no API key.
 *
 * Sources:
 *   - GeckoTerminal: multi-chain DEX pool data + OHLCV
 *   - Binance USDⓈ-M futures: taker buy/sell volume, top-trader positions
 *   - CoinGlass public: (fallback to Binance where glass requires key)
 *   - Yahoo Finance: batch quotes for watchlists
 */

import { defineTool, fetchJson, type HarnessTool } from './registry.js';

// NOTE: Binance perp tools (get_perp_taker_volume, get_top_trader_positions) were
// removed — Binance USDⓈ-M 451-geo-blocks US egress. Perp data now comes from
// hyperliquid.ts (get_perp_snapshot / list_perp_markets / get_perp_positions /
// get_perp_funding_history), the public perpetuals data source.

const GECKO_TERMINAL = 'https://api.geckoterminal.com/api/v2';
const BINANCE_FUTURES = 'https://fapi.binance.com';
const YAHOO_QUOTE = 'https://query1.finance.yahoo.com/v7/finance/quote';

export const getDexPoolTool: HarnessTool = defineTool({
  name: 'get_dex_pool',
  description:
    'Real DEX pool data via GeckoTerminal (no key): reserve, volume, price, transactions for a specific pool on any supported chain (eth, bsc, solana, arbitrum, base, …).',
  category: 'market-data',
  parameters: {
    type: 'object',
    properties: {
      network: { type: 'string', description: 'Chain slug, e.g. eth, bsc, solana, arbitrum, base.' },
      poolAddress: { type: 'string', description: 'Pool contract address.' },
    },
    required: ['network', 'poolAddress'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const url = `${GECKO_TERMINAL}/networks/${args.network.toLowerCase()}/pools/${args.poolAddress}`;
    const r = await fetchJson(url, { headers: { accept: 'application/json' } });
    if (!r.ok) return r.error;
    const d = (r.data as { data?: { attributes?: Record<string, unknown> } }).data?.attributes ?? {};
    return {
      source: 'geckoterminal',
      network: args.network,
      pool: args.poolAddress,
      name: d.name,
      priceUsd: d.base_token_price_usd,
      fdvUsd: d.fdv_usd,
      reserveUsd: d.reserve_in_usd,
      volume24hUsd: (d.volume_usd as Record<string, unknown>)?.h24,
      txns24h: (d.transactions as Record<string, unknown>)?.h24,
      priceChange24hPct: (d.price_change_percentage as Record<string, unknown>)?.h24,
    };
  },
});

export const getBatchQuotesTool: HarnessTool = defineTool({
  name: 'get_batch_quotes',
  description:
    'Batch real-time quotes for multiple symbols in one call (Yahoo Finance): stocks, crypto, FX, indices. Example symbols: ["AAPL","MSFT","BTC-USD","^GSPC","EURUSD=X"].',
  category: 'market-data',
  parameters: {
    type: 'object',
    properties: {
      symbols: { type: 'array', items: { type: 'string' }, description: 'Up to 20 tickers.' },
    },
    required: ['symbols'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const syms = ((args.symbols as string[] | undefined) ?? []).slice(0, 20).map((s: string) => s.trim().toUpperCase());
    if (syms.length === 0) return { error: { kind: 'bad_input', message: 'symbols[] required.' } };
    const r = await fetchJson(`${YAHOO_QUOTE}?symbols=${encodeURIComponent(syms.join(','))}`, {
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    });
    if (!r.ok) return r.error;
    const results = (r.data as { quoteResponse?: { result?: Array<Record<string, unknown>> } }).quoteResponse?.result ?? [];
    return {
      source: 'yahoo-finance',
      quotes: results.map((q) => ({
        symbol: q.symbol,
        name: q.shortName ?? q.longName,
        price: q.regularMarketPrice,
        changePct: q.regularMarketChangePercent,
        currency: q.currency,
        marketCap: q.marketCap,
        marketState: q.marketState,
      })),
      missing: syms.filter((s) => !results.some((q) => q.symbol === s)),
    };
  },
});

export const getTrendingPoolsTool: HarnessTool = defineTool({
  name: 'get_trending_pools',
  description:
    'Trending DEX pools on a chain via GeckoTerminal (no key): highest-momentum pools in the last 24h with price change and volume.',
  category: 'market-data',
  parameters: {
    type: 'object',
    properties: {
      network: { type: 'string', description: 'Chain slug, e.g. eth, solana, base.' },
      limit: { type: 'number', description: 'Pools to return (default 10).' },
    },
    required: ['network'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const limit = Math.min(Math.max(1, args.limit ?? 10), 30);
    const r = await fetchJson(
      `${GECKO_TERMINAL}/networks/${args.network.toLowerCase()}/trending_pools?page=1`,
      { headers: { accept: 'application/json' } },
    );
    if (!r.ok) return r.error;
    const pools = ((r.data as { data?: Array<Record<string, unknown>> }).data ?? []).slice(0, limit);
    return {
      source: 'geckoterminal',
      network: args.network,
      pools: pools.map((p) => {
        const a = p.attributes as Record<string, unknown>;
        return {
          name: a.name,
          address: a.address,
          priceUsd: a.base_token_price_usd,
          reserveUsd: a.reserve_in_usd,
          volume24hUsd: (a.volume_usd as Record<string, unknown>)?.h24,
          change24hPct: (a.price_change_percentage as Record<string, unknown>)?.h24,
        };
      }),
    };
  },
});

export const defiAdvancedTools: HarnessTool[] = [
  getDexPoolTool,
  getBatchQuotesTool,
  getTrendingPoolsTool,
];
