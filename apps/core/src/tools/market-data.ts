/**
 * Domain: market-data
 *
 * Real sources (read-only, no key required):
 *   - CoinGecko public v3: /api/v3/simple/price, /api/v3/search, /api/v3/coins/{id}/market_chart
 *   - Binance spot public: /api/v3/klines
 * Stubs (writes / venues needing keys):
 *   - get_funding_rate: perp funding lives on perp venues (Hyperliquid/Lighter).
 *     Real data for funding history is in perps.ts:get_funding_rate_history via
 *     Binance USDⓈ-M /fapi/v1/fundingRate (no key), so the spot-side
 *     get_funding_rate stays a stub and points callers at the perp tool.
 */

import { defineTool, fetchJson } from "./registry.js";
import type { AgentTool } from "../loop/types.js";

const COINGECKO = "https://api.coingecko.com/api/v3";
const BINANCE_SPOT = "https://api.binance.com/api/v3";

/** Alias map so callers can say "btc"/"BTC"/"bitcoin" interchangeably. */
const SYMBOL_TO_COINGECKO_ID: Record<string, string> = {
  btc: "bitcoin",
  eth: "ethereum",
  sol: "solana",
  bnb: "binancecoin",
  xrp: "ripple",
  doge: "dogecoin",
  ada: "cardano",
  avax: "avalanche-2",
  link: "chainlink",
  matic: "matic-network",
  dot: "polkadot",
  ltc: "litecoin",
  atom: "cosmos",
  uni: "uniswap",
  near: "near",
  apt: "aptos",
  arb: "arbitrum",
  op: "optimism",
  sui: "sui",
  pepe: "pepe",
  usdt: "tether",
  usdc: "usd-coin",
};

function resolveCoinGeckoId(symbolOrId: string): string {
  const k = symbolOrId.trim().toLowerCase();
  return SYMBOL_TO_COINGECKO_ID[k] ?? k;
}

export const getTokenPriceTool: AgentTool<any, any> = defineTool({
  name: "get_token_price",
  description:
    "Get real-time USD price, market cap, 24h volume and 24h change for one or more tokens. Uses CoinGecko public API (no key). Accepts symbols (BTC, ETH) or CoinGecko ids (bitcoin, ethereum).",
  category: "market-data",
  parameters: {
    type: "object",
    properties: {
      symbols: {
        type: "array",
        items: { type: "string" },
        description: "List of tickers or CoinGecko ids, e.g. [\"BTC\",\"ETH\"]",
      },
      vsCurrency: { type: "string", default: "usd" },
    },
    required: ["symbols"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const symbols = (args.symbols as string[] | undefined) ?? [];
    const vs = ((args.vsCurrency as string | undefined) ?? "usd").toLowerCase();
    if (symbols.length === 0) {
      return { error: { kind: "input", message: "symbols must be a non-empty array" } };
    }
    const ids = symbols.map(resolveCoinGeckoId).join(",");
    const url =
      `${COINGECKO}/simple/price?ids=${encodeURIComponent(ids)}` +
      `&vs_currencies=${encodeURIComponent(vs)}` +
      "&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true";
    const r = await fetchJson(url);
    if (!r.ok) return r.error;
    const data = r.data as Record<string, Record<string, number>>;
    return {
      source: "coingecko",
      vsCurrency: vs,
      prices: symbols.map((sym) => {
        const id = resolveCoinGeckoId(sym);
        const row = data[id];
        if (!row) {
          return { symbol: sym, id, error: "not found on CoinGecko" };
        }
        return {
          symbol: sym.toUpperCase(),
          id,
          price: row[vs],
          marketCap: row[`${vs}_market_cap`],
          volume24h: row[`${vs}_24h_vol`],
          change24hPct: row[`${vs}_24h_change`],
          lastUpdatedAt: row.last_updated_at,
        };
      }),
    };
  },
});

export const searchTokensTool: AgentTool<any, any> = defineTool({
  name: "search_tokens",
  description:
    "Search tokens by name/symbol/contract query via CoinGecko /search (public, no key). Returns top matches with id, symbol, name, market cap rank.",
  category: "market-data",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search string, e.g. \"sol\" or \"pepe\"" },
      limit: { type: "number", default: 10, minimum: 1, maximum: 50 },
    },
    required: ["query"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const query = (args.query as string | undefined) ?? "";
    const limit = Math.min(Math.max((args.limit as number | undefined) ?? 10, 1), 50);
    if (!query.trim()) {
      return { error: { kind: "input", message: "query is required" } };
    }
    const url = `${COINGECKO}/search?query=${encodeURIComponent(query)}`;
    const r = await fetchJson(url);
    if (!r.ok) return r.error;
    const data = r.data as {
      coins?: Array<{
        id: string;
        name: string;
        symbol: string;
        market_cap_rank: number | null;
        thumb?: string;
      }>;
    };
    return {
      source: "coingecko",
      query,
      results: (data.coins ?? []).slice(0, limit).map((c) => ({
        id: c.id,
        name: c.name,
        symbol: c.symbol?.toUpperCase(),
        marketCapRank: c.market_cap_rank,
        thumb: c.thumb,
      })),
    };
  },
});

export const getMarketChartTool: AgentTool<any, any> = defineTool({
  name: "get_market_chart",
  description:
    "Get historical price/market-cap/volume series for a token via CoinGecko /coins/{id}/market_chart (public). Use days <= 90 for hourly, days > 90 for daily granularity. Read-only data: this does not display a chart or switch the UI. Use market_search then market_set_view to open a Markets price chart.",
  category: "market-data",
  parameters: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Ticker or CoinGecko id, e.g. \"BTC\"" },
      days: { type: "number", default: 7, minimum: 1, maximum: 365 },
      vsCurrency: { type: "string", default: "usd" },
    },
    required: ["symbol"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const symbol = (args.symbol as string | undefined) ?? "";
    const days = Math.min(Math.max((args.days as number | undefined) ?? 7, 1), 365);
    const vs = ((args.vsCurrency as string | undefined) ?? "usd").toLowerCase();
    if (!symbol.trim()) {
      return { error: { kind: "input", message: "symbol is required" } };
    }
    const id = resolveCoinGeckoId(symbol);
    const url =
      `${COINGECKO}/coins/${encodeURIComponent(id)}/market_chart` +
      `?vs_currency=${encodeURIComponent(vs)}&days=${days}`;
    const r = await fetchJson(url);
    if (!r.ok) return r.error;
    const data = r.data as {
      prices?: [number, number][];
      market_caps?: [number, number][];
      total_volumes?: [number, number][];
    };
    return {
      source: "coingecko",
      id,
      symbol: symbol.toUpperCase(),
      days,
      vsCurrency: vs,
      prices: (data.prices ?? []).map(([t, p]) => ({ t, price: p })),
      marketCaps: (data.market_caps ?? []).map(([t, v]) => ({ t, marketCap: v })),
      volumes: (data.total_volumes ?? []).map(([t, v]) => ({ t, volume: v })),
    };
  },
});

export const getFundingRateTool: AgentTool<any, any> = defineTool({
  name: "get_funding_rate",
  description:
    "STUB — funding rate of a perp market. Funding lives on perp venues (Hyperliquid, Lighter, Binance USDⓈ-M). For a REAL no-key source use perps.get_funding_rate_history (Binance /fapi/v1/fundingRate).",
  category: "market-data",
  parameters: {
    type: "object",
    properties: {
      market: { type: "string", description: "Perp market, e.g. \"BTC-USD\" or \"BTCUSDT\"" },
      venue: { type: "string", enum: ["hyperliquid", "lighter", "binance"], default: "binance" },
    },
    required: ["market"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const market = (args.market as string | undefined) ?? "";
    const venue = ((args.venue as string | undefined) ?? "binance").toLowerCase();
    return {
      stub: true,
      reason:
        "live funding snapshots require perp-venue API auth or venue-specific websockets; redirected to get_funding_rate_history for the no-key Binance source",
      market,
      venue,
      hint: {
        useTool: "get_funding_rate_history",
        example: { symbol: "BTCUSDT", limit: 50 },
      },
      // Plausible-looking placeholder, clearly marked:
      fundingRate: 0.0001,
      nextFundingTime: null,
    };
  },
});

const BINANCE_INTERVALS = new Set([
  "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "6h", "8h", "12h",
  "1d", "3d", "1w", "1M",
]);

export const getKlinesTool: AgentTool<any, any> = defineTool({
  name: "get_klines",
  description:
    "Get OHLCV klines (candlesticks) from Binance spot public /api/v3/klines (no key). Symbol like BTCUSDT, ETHUSDT. Intervals 1m,5m,15m,1h,4h,1d,1w etc. Max limit 1000.",
  category: "market-data",
  parameters: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Binance spot symbol, e.g. \"BTCUSDT\"" },
      interval: {
        type: "string",
        enum: [...BINANCE_INTERVALS],
        default: "1h",
      },
      limit: { type: "number", default: 100, minimum: 1, maximum: 1000 },
    },
    required: ["symbol"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const symbol = ((args.symbol as string | undefined) ?? "").toUpperCase().trim();
    const interval = ((args.interval as string | undefined) ?? "1h") as string;
    const limit = Math.min(Math.max((args.limit as number | undefined) ?? 100, 1), 1000);
    if (!symbol) {
      return { error: { kind: "input", message: "symbol is required" } };
    }
    if (!BINANCE_INTERVALS.has(interval)) {
      return { error: { kind: "input", message: `interval must be one of ${[...BINANCE_INTERVALS].join(",")}` } };
    }
    const url =
      `${BINANCE_SPOT}/klines?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    const r = await fetchJson(url);
    if (!r.ok) return r.error;
    const rows = r.data as unknown[][];
    // Binance kline: [openTime, open, high, low, close, volume, closeTime, quoteVol, trades, takerBuyBase, takerBuyQuote, ignore]
    return {
      source: "binance-spot",
      symbol,
      interval,
      limit,
      candles: rows.map((k) => ({
        openTime: Number(k[0]),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
        closeTime: Number(k[6]),
        quoteVolume: Number(k[7]),
        trades: Number(k[8]),
      })),
    };
  },
});

export const marketDataTools: AgentTool<any, any>[] = [
  getTokenPriceTool,
  searchTokensTool,
  getMarketChartTool,
  getFundingRateTool,
  getKlinesTool,
];
