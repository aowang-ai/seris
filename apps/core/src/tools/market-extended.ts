/**
 * Domain: market-extended — real public market data, no API key required.
 *
 * Sources:
 *   - alternative.me Fear & Greed Index (crypto sentiment)
 *   - CoinGecko: trending, global market data, exchange rates
 *   - Binance USDⓈ-M futures: funding rate, open interest, long/short ratio
 *   - DefiLlama: TVL for chains and protocols
 */

import { defineTool, fetchJson, type HarnessTool } from './registry.js';

const COINGECKO = 'https://api.coingecko.com/api/v3';
const BINANCE_FUTURES = 'https://fapi.binance.com/fapi/v1';
const FEAR_GREED = 'https://api.alternative.me/fng';
const DEFILLAMA = 'https://api.llama.fi';

/** Normalize a perp symbol to Binance's BTCUSDT-style pair. */
function toPerpPair(symbol: string): string {
  const s = symbol.trim().toUpperCase().replace(/[-_/].*$/, '');
  return s.endsWith('USDT') ? s : `${s}USDT`;
}

export const getFearGreedTool: HarnessTool = defineTool({
  name: 'get_fear_greed',
  description:
    'Crypto Fear & Greed Index (alternative.me) — market sentiment from 0 (extreme fear) to 100 (extreme greed), with historical values.',
  category: 'market-data',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Days of history (default 1, max 30).' },
    },
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const limit = Math.min(Math.max(1, args.limit ?? 1), 30);
    const r = await fetchJson(`${FEAR_GREED}/?limit=${limit}`);
    if (!r.ok) return r.error;
    const data = (r.data as { data?: Array<{ value: string; value_classification: string; timestamp: string }> }).data ?? [];
    return {
      source: 'alternative.me',
      current: data[0]
        ? { value: Number(data[0].value), classification: data[0].value_classification }
        : null,
      history: data.map((d) => ({
        value: Number(d.value),
        classification: d.value_classification,
        timestamp: Number(d.timestamp),
      })),
    };
  },
});

export const getTrendingTool: HarnessTool = defineTool({
  name: 'get_trending_tokens',
  description: 'Top-7 trending tokens on CoinGecko (most searched in the last 24h), with price and market-cap rank.',
  category: 'market-data',
  parameters: { type: 'object', properties: {} },
  async execute() {
    const r = await fetchJson(`${COINGECKO}/search/trending`);
    if (!r.ok) return r.error;
    const coins = (r.data as { coins?: Array<{ item?: Record<string, unknown> }> }).coins ?? [];
    return {
      source: 'coingecko',
      trending: coins.map((c) => {
        const i = c.item ?? {};
        return {
          id: i.id,
          symbol: i.symbol,
          name: i.name,
          marketCapRank: i.market_cap_rank,
          priceUsd: (i.data as Record<string, unknown> | undefined)?.price,
          change24hPct: (i.data as Record<string, unknown> | undefined)?.price_change_percentage_24h,
        };
      }),
    };
  },
});

export const getGlobalMarketTool: HarnessTool = defineTool({
  name: 'get_global_market',
  description: 'Global crypto market data: total market cap, 24h volume, BTC/ETH dominance, active cryptocurrencies, market change.',
  category: 'market-data',
  parameters: { type: 'object', properties: {} },
  async execute() {
    const r = await fetchJson(`${COINGECKO}/global`);
    if (!r.ok) return r.error;
    const d = (r.data as { data?: Record<string, unknown> }).data ?? {};
    return {
      source: 'coingecko',
      totalMarketCapUsd: (d.total_market_cap as Record<string, number>)?.usd,
      totalVolumeUsd: (d.total_volume as Record<string, number>)?.usd,
      btcDominancePct: (d.market_cap_percentage as Record<string, number>)?.btc,
      ethDominancePct: (d.market_cap_percentage as Record<string, number>)?.eth,
      activeCryptocurrencies: d.active_cryptocurrencies,
      markets: d.markets,
      marketCapChange24hPct: d.market_cap_change_percentage_24h_usd,
    };
  },
});

export const getPerpFundingRateTool: HarnessTool = defineTool({
  name: 'get_perp_funding_rate',
  description: 'Real perpetual futures funding rate for a symbol (Binance USDⓈ-M, no key). Returns current + recent funding history.',
  category: 'perps',
  parameters: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Base symbol, e.g. BTC, ETH.' },
      limit: { type: 'number', description: 'Funding history entries (default 5).' },
    },
    required: ['symbol'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const pair = toPerpPair(args.symbol);
    const limit = Math.min(Math.max(1, args.limit ?? 5), 100);
    const [current, history] = await Promise.all([
      fetchJson(`${BINANCE_FUTURES}/premiumIndex?symbol=${pair}`),
      fetchJson(`${BINANCE_FUTURES}/fundingRate?symbol=${pair}&limit=${limit}`),
    ]);
    if (!current.ok) return current.error;
    const c = current.data as Record<string, unknown>;
    return {
      source: 'binance-futures',
      symbol: pair,
      markPrice: Number(c.markPrice),
      indexPrice: Number(c.indexPrice),
      currentFundingRatePct: Number(c.lastFundingRate) * 100,
      nextFundingTime: c.nextFundingTime,
      history: history.ok
        ? (history.data as Array<Record<string, unknown>>).map((h) => ({
            fundingRatePct: Number(h.fundingRate) * 100,
            fundingTime: h.fundingTime,
          }))
        : [],
    };
  },
});

export const getPerpOpenInterestTool: HarnessTool = defineTool({
  name: 'get_perp_open_interest',
  description: 'Real open interest for a perpetual futures symbol (Binance USDⓈ-M). OI in contracts + notional USD value.',
  category: 'perps',
  parameters: {
    type: 'object',
    properties: { symbol: { type: 'string', description: 'Base symbol, e.g. BTC.' } },
    required: ['symbol'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const pair = toPerpPair(args.symbol);
    const [oi, price] = await Promise.all([
      fetchJson(`${BINANCE_FUTURES}/openInterest?symbol=${pair}`),
      fetchJson(`${BINANCE_FUTURES}/premiumIndex?symbol=${pair}`),
    ]);
    if (!oi.ok) return oi.error;
    const o = oi.data as Record<string, unknown>;
    const oiContracts = Number(o.openInterest);
    const markPrice = price.ok ? Number((price.data as Record<string, unknown>).markPrice) : null;
    return {
      source: 'binance-futures',
      symbol: pair,
      openInterestContracts: oiContracts,
      openInterestUsd: markPrice ? oiContracts * markPrice : null,
      markPrice,
      timestamp: o.time,
    };
  },
});

export const getLongShortRatioTool: HarnessTool = defineTool({
  name: 'get_long_short_ratio',
  description: 'Real long/short account ratio for a perp symbol (Binance top trader + global accounts). Sentiment gauge.',
  category: 'perps',
  parameters: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Base symbol, e.g. BTC.' },
      period: { type: 'string', description: '5m, 15m, 30m, 1h, 2h, 4h, 6h, 12h, 1d (default 1h).' },
    },
    required: ['symbol'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const pair = toPerpPair(args.symbol);
    const period = args.period ?? '1h';
    const r = await fetchJson(
      `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${pair}&period=${period}&limit=5`,
    );
    if (!r.ok) return r.error;
    const rows = (r.data as Array<Record<string, unknown>>) ?? [];
    return {
      source: 'binance-futures',
      symbol: pair,
      period,
      ratios: rows.map((x) => ({
        longAccountPct: Number(x.longAccount) * 100,
        shortAccountPct: Number(x.shortAccount) * 100,
        longShortRatio: Number(x.longShortRatio),
        timestamp: x.timestamp,
      })),
    };
  },
});

export const getChainTvlTool: HarnessTool = defineTool({
  name: 'get_chain_tvl',
  description: 'Real Total Value Locked (TVL) for a blockchain or DeFi protocol via DefiLlama (no key).',
  category: 'market-data',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Chain (ethereum, solana) or protocol (aave, uniswap) slug.' },
    },
    required: ['name'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const slug = args.name.trim().toLowerCase();
    // Protocol endpoint is slug-exact — try it first for slugs like aave-v3.
    const proto = await fetchJson(`${DEFILLAMA}/protocol/${slug}`, { timeoutMs: 8000 });
    if (proto.ok) {
      const p = proto.data as Record<string, unknown>;
      if (p && p.name) {
        // /protocol/{slug} returns tvl as a time-series array; latest total at the tail.
        const tvlSeries = Array.isArray(p.tvl) ? (p.tvl as Array<Record<string, unknown>>) : [];
        const latest = tvlSeries.length > 0 ? tvlSeries[tvlSeries.length - 1] : null;
        const currentChainTvls = (p.currentChainTvls as Record<string, number>) ?? {};
        const chainSum = Object.values(currentChainTvls).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
        const tvlUsd =
          (latest?.totalLiquidityUSD as number | undefined) ??
          (latest?.totalLiquidity as number | undefined) ??
          (chainSum > 0 ? chainSum : null);
        return {
          source: 'defillama',
          type: 'protocol',
          name: p.name,
          tvlUsd,
          category: p.category,
          chains: p.chains,
          currentChainTvls,
        };
      }
    }
    // Fall back to chain lookup.
    const chain = await fetchJson(`${DEFILLAMA}/v2/chains`, { timeoutMs: 8000 });
    if (chain.ok) {
      const chains = (chain.data as Array<Record<string, unknown>>) ?? [];
      const match = chains.find((c) => String(c.name).toLowerCase() === slug);
      if (match) {
        return { source: 'defillama', type: 'chain', name: match.name, tvlUsd: match.tvl, tokenSymbol: match.tokenSymbol };
      }
    }
    return { error: { kind: 'not_found', message: `No chain or protocol named "${args.name}" on DefiLlama.` } };
  },
});

export const marketExtendedTools: HarnessTool[] = [
  getFearGreedTool,
  getTrendingTool,
  getGlobalMarketTool,
  getPerpFundingRateTool,
  getPerpOpenInterestTool,
  getLongShortRatioTool,
  getChainTvlTool,
];
