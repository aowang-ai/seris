import { toolSignal } from '../runtime/toolContext.js';
/**
 * Domain: onchain-market — real on-chain & CEX market structure data, no key.
 *
 * Sources:
 *   - Cloudflare Ethereum RPC: gas price
 *   - mempool.space: Bitcoin fee estimates
 *   - ENS Ideas public API: ENS resolution
 *   - Coinbase Exchange (US-friendly): L2 order book + ticker
 *   - DefiLlama stablecoins: supply breakdown
 *   - Yahoo Finance: daily OHLCV history
 */

import { defineTool, fetchJson, type HarnessTool } from './registry.js';

const ETH_RPC = 'https://cloudflare-eth.com';
const MEMPOOL = 'https://mempool.space/api';
const COINBASE = 'https://api.exchange.coinbase.com';
const DEFILLAMA_STABLE = 'https://stablecoins.llama.fi';
const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';

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

export const getEthGasPriceTool: HarnessTool = defineTool({
  name: 'get_eth_gas_price',
  description: 'Real current Ethereum gas price (Cloudflare public RPC) in gwei, plus latest block number.',
  category: 'market-data',
  parameters: { type: 'object', properties: {} },
  async execute() {
    try {
      const [gasHex, blockHex] = (await Promise.all([
        ethRpc('eth_gasPrice', []),
        ethRpc('eth_blockNumber', []),
      ])) as [string, string];
      return {
        source: 'cloudflare-eth-rpc',
        gasPriceGwei: Number(BigInt(gasHex)) / 1e9,
        blockNumber: parseInt(blockHex, 16),
      };
    } catch (e) {
      return { error: { kind: 'rpc', message: (e as Error).message } };
    }
  },
});


export const getBtcFeesTool: HarnessTool = defineTool({
  name: 'get_btc_fees',
  description: 'Real Bitcoin mempool fee estimates (mempool.space): sat/vB for fastest, 30min, 1hr, economy, minimum.',
  category: 'market-data',
  parameters: { type: 'object', properties: {} },
  async execute() {
    const r = await fetchJson(`${MEMPOOL}/fee-estimates`);
    if (!r.ok) return r.error;
    const fees = r.data as Record<string, number>;
    return {
      source: 'mempool.space',
      unit: 'sat/vB',
      fastest: fees['1'],
      halfHour: fees['3'],
      hour: fees['6'],
      economy: fees['144'],
      minimum: fees['1008'],
    };
  },
});

export const resolveEnsTool: HarnessTool = defineTool({
  name: 'resolve_ens',
  description: 'Resolve an ENS name (nick.eth) to an Ethereum address, or reverse-resolve an address, via the public ENS Ideas API.',
  category: 'market-data',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'ENS name (nick.eth) or 0x address.' } },
    required: ['query'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const q = args.query.trim();
    const r = await fetchJson(`https://api.ensideas.com/ens/resolve/${encodeURIComponent(q)}`);
    if (!r.ok) return r.error;
    const d = r.data as Record<string, unknown>;
    return {
      source: 'ensideas',
      query: q,
      name: d.name ?? null,
      address: d.address ?? null,
      displayName: d.displayName ?? null,
      avatar: d.avatar ?? null,
    };
  },
});

export const getOrderBookTool: HarnessTool = defineTool({
  name: 'get_order_book',
  description: 'Real L2 order book + ticker for a Coinbase pair (BTC-USD, ETH-USD, SOL-USD): best bid/ask, spread, top 10 levels each side. US-friendly, no key.',
  category: 'market-data',
  parameters: {
    type: 'object',
    properties: { product: { type: 'string', description: 'Coinbase product id, e.g. BTC-USD, ETH-USD.' } },
    required: ['product'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const prod = args.product.trim().toUpperCase();
    const [book, ticker] = await Promise.all([
      fetchJson(`${COINBASE}/products/${prod}/book?level=2`),
      fetchJson(`${COINBASE}/products/${prod}/ticker`),
    ]);
    if (!book.ok) return book.error;
    const b = book.data as { bids?: Array<[string, string, number]>; asks?: Array<[string, string, number]> };
    const t = ticker.ok ? (ticker.data as Record<string, unknown>) : {};
    const bestBid = b.bids?.[0] ? Number(b.bids[0][0]) : null;
    const bestAsk = b.asks?.[0] ? Number(b.asks[0][0]) : null;
    return {
      source: 'coinbase',
      product: prod,
      price: t.price ? Number(t.price) : null,
      bestBid,
      bestAsk,
      spread: bestBid && bestAsk ? bestAsk - bestBid : null,
      spreadPct: bestBid && bestAsk ? ((bestAsk - bestBid) / bestAsk) * 100 : null,
      volume24h: t.volume ? Number(t.volume) : null,
      bids: (b.bids ?? []).slice(0, 10).map(([p2, s2]) => ({ price: Number(p2), size: Number(s2) })),
      asks: (b.asks ?? []).slice(0, 10).map(([p2, s2]) => ({ price: Number(p2), size: Number(s2) })),
    };
  },
});

export const getStablecoinSupplyTool: HarnessTool = defineTool({
  name: 'get_stablecoin_supply',
  description: 'Real stablecoin market data (DefiLlama): total circulating supply per coin (USDT, USDC, DAI, …), dominant chain.',
  category: 'market-data',
  parameters: {
    type: 'object',
    properties: { limit: { type: 'number', description: 'Top coins to list (default 10).' } },
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const limit = Math.min(Math.max(1, args.limit ?? 10), 50);
    const r = await fetchJson(`${DEFILLAMA_STABLE}/stablecoins?includePrices=true`);
    if (!r.ok) return r.error;
    const pegged = ((r.data as { peggedAssets?: Array<Record<string, unknown>> }).peggedAssets ?? [])
      .filter((a) => a.pegType === 'peggedUSD')
      .sort(
        (a, b) =>
          Number((b.circulating as Record<string, number>)?.peggedUSD ?? 0) -
          Number((a.circulating as Record<string, number>)?.peggedUSD ?? 0),
      )
      .slice(0, limit);
    return {
      source: 'defillama-stablecoins',
      coins: pegged.map((a) => ({
        name: a.name,
        symbol: a.symbol,
        circulatingUsd: (a.circulating as Record<string, number>)?.peggedUSD,
        price: a.price,
        chains: a.chains,
      })),
    };
  },
});

export const getStockHistoryTool: HarnessTool = defineTool({
  name: 'get_stock_history',
  description: 'Real daily OHLCV history for a stock/ETF/index/FX/crypto via Yahoo Finance. Returns up to N days of candles.',
  category: 'market-data',
  parameters: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Ticker (AAPL, ^GSPC, EURUSD=X, BTC-USD).' },
      days: { type: 'number', description: 'Days of history (default 30, max 365).' },
    },
    required: ['symbol'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const days = Math.min(Math.max(1, args.days ?? 30), 365);
    const sym = args.symbol.trim().toUpperCase();
    const r = await fetchJson(`${YAHOO_CHART}/${encodeURIComponent(sym)}?interval=1d&range=${days}d`, {
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    });
    if (!r.ok) return r.error;
    const result = (r.data as { chart?: { result?: Array<Record<string, unknown>> } }).chart?.result?.[0];
    if (!result) return { error: { kind: 'not_found', message: `No Yahoo history for "${sym}".` } };
    const ts = (result.timestamp as number[]) ?? [];
    const quote = (((result.indicators as Record<string, unknown>)?.quote) as Array<Record<string, unknown>>)?.[0] ?? {};
    const closes = (quote.close as Array<number | null>) ?? [];
    const candles = ts
      .map((t, i) => ({
        date: new Date(t * 1000).toISOString().slice(0, 10),
        open: ((quote.open as Array<number | null>) ?? [])[i],
        high: ((quote.high as Array<number | null>) ?? [])[i],
        low: ((quote.low as Array<number | null>) ?? [])[i],
        close: closes[i],
        volume: ((quote.volume as Array<number | null>) ?? [])[i],
      }))
      .filter((c) => c.close != null);
    return { source: 'yahoo-finance', symbol: sym, days: candles.length, candles };
  },
});

export const onchainMarketTools: HarnessTool[] = [
  getEthGasPriceTool,
  getBtcFeesTool,
  resolveEnsTool,
  getOrderBookTool,
  getStablecoinSupplyTool,
  getStockHistoryTool,
];
