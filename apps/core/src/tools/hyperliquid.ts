import { toolSignal } from '../runtime/toolContext.js';
/** Public Hyperliquid market snapshots, funding history and address positions. */

import { defineTool, type HarnessTool } from './registry.js';

const HL = 'https://api.hyperliquid.xyz/info';

async function hlInfo<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(HL, {
    method: 'POST',
    signal: toolSignal(10000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`hyperliquid ${res.status}`);
  return (await res.json()) as T;
}

interface AssetCtx {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  markPx: string;
  midPx?: string;
  oraclePx: string;
}
interface Meta {
  universe: Array<{ name: string; szDecimals: number; maxLeverage: number; isDelisted?: boolean }>;
}

async function allAssetCtxs(): Promise<{ meta: Meta; ctxs: AssetCtx[] }> {
  const [meta, ctxs] = await hlInfo<[Meta, AssetCtx[]]>({ type: 'metaAndAssetCtxs' });
  return { meta, ctxs };
}

function findCtx(meta: Meta, ctxs: AssetCtx[], symbol: string) {
  const sym = symbol.trim().toUpperCase().replace(/[-_]?(PERP|USDT|USD)$/, '');
  const idx = meta.universe.findIndex((u) => u.name.toUpperCase() === sym);
  if (idx < 0) return null;
  return { coin: meta.universe[idx], ctx: ctxs[idx] };
}

export const hlPerpSnapshotTool: HarnessTool = defineTool({
  name: 'get_perp_snapshot',
  description:
    "Real Hyperliquid perp snapshot for a symbol (BTC, ETH, SOL, …): mark price, 24h volume, current funding rate, open interest, max leverage. No API key required.",
  category: 'perps',
  parameters: {
    type: 'object',
    properties: { symbol: { type: 'string', description: 'Coin symbol, e.g. BTC, ETH, SOL.' } },
    required: ['symbol'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    try {
      const { meta, ctxs } = await allAssetCtxs();
      const found = findCtx(meta, ctxs, args.symbol);
      if (!found) return { error: { kind: 'not_found', message: `No Hyperliquid perp for "${args.symbol}".` } };
      const { coin, ctx } = found;
      return {
        source: 'hyperliquid',
        symbol: coin.name,
        markPrice: Number(ctx.markPx),
        oraclePrice: Number(ctx.oraclePx),
        prevDayPrice: Number(ctx.prevDayPx),
        change24hPct: ctx.prevDayPx ? (Number(ctx.markPx) / Number(ctx.prevDayPx) - 1) * 100 : null,
        volume24hUsd: Number(ctx.dayNtlVlm),
        openInterestContracts: Number(ctx.openInterest),
        openInterestUsd: Number(ctx.openInterest) * Number(ctx.markPx),
        fundingRateHourlyPct: Number(ctx.funding) * 100,
        fundingRateAnnualizedPct: Number(ctx.funding) * 100 * 24 * 365,
        maxLeverage: coin.maxLeverage,
        szDecimals: coin.szDecimals,
      };
    } catch (e) {
      return { error: { kind: 'network', message: (e as Error).message } };
    }
  },
});

export const hlPerpMarketsTool: HarnessTool = defineTool({
  name: 'list_perp_markets',
  description: 'List all live Hyperliquid perp markets with mark price, 24h volume, funding, and open interest — the full tradeable universe.',
  category: 'perps',
  parameters: {
    type: 'object',
    properties: { limit: { type: 'number', description: 'Markets to return, sorted by 24h volume (default 20).' } },
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    try {
      const limit = Math.min(Math.max(1, args.limit ?? 20), 200);
      const { meta, ctxs } = await allAssetCtxs();
      const rows = meta.universe
        .map((coin, i) => ({ coin, ctx: ctxs[i] }))
        .filter((r) => r.ctx && !r.coin.isDelisted)
        .map((r) => ({
          symbol: r.coin.name,
          markPrice: Number(r.ctx.markPx),
          volume24hUsd: Number(r.ctx.dayNtlVlm),
          openInterestUsd: Number(r.ctx.openInterest) * Number(r.ctx.markPx),
          fundingRateHourlyPct: Number(r.ctx.funding) * 100,
          change24hPct: r.ctx.prevDayPx ? (Number(r.ctx.markPx) / Number(r.ctx.prevDayPx) - 1) * 100 : null,
          maxLeverage: r.coin.maxLeverage,
        }))
        .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
        .slice(0, limit);
      return { source: 'hyperliquid', marketCount: rows.length, markets: rows };
    } catch (e) {
      return { error: { kind: 'network', message: (e as Error).message } };
    }
  },
});

export const hlPerpPositionsTool: HarnessTool = defineTool({
  name: 'get_perp_positions',
  description:
    'Real open perp positions for any Hyperliquid account address: per-market size, entry price, unrealized PnL, leverage, liquidation price, margin. Public on-chain data — pass any 0x address.',
  category: 'perps',
  parameters: {
    type: 'object',
    properties: { address: { type: 'string', description: 'Hyperliquid account / EVM address (0x…).' } },
    required: ['address'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    try {
      const state = await hlInfo<Record<string, unknown>>({ type: 'clearinghouseState', user: args.address });
      const marginSummary = (state as { marginSummary?: Record<string, unknown> }).marginSummary ?? {};
      const positions = ((state as { assetPositions?: Array<Record<string, unknown>> }).assetPositions ?? [])
        .map((ap) => (ap.position as Record<string, unknown>) ?? {})
        .filter((p) => Number(p.szi ?? 0) !== 0)
        .map((p) => ({
          coin: p.coin,
          size: Number(p.szi),
          side: Number(p.szi) > 0 ? 'long' : 'short',
          entryPrice: Number(p.entryPx ?? 0),
          positionValueUsd: Number(p.positionValue ?? 0),
          unrealizedPnlUsd: Number(p.unrealizedPnl ?? 0),
          leverage: (p.leverage as Record<string, unknown>)?.value,
          liquidationPrice: p.liquidationPx ? Number(p.liquidationPx) : null,
          marginUsedUsd: Number(p.marginUsed ?? 0),
        }));
      return {
        source: 'hyperliquid',
        address: args.address,
        accountValueUsd: Number(marginSummary.accountValue ?? 0),
        totalMarginUsedUsd: Number(marginSummary.totalMarginUsed ?? 0),
        totalNotionalUsd: Number(marginSummary.totalNtlPos ?? 0),
        positions,
      };
    } catch (e) {
      return { error: { kind: 'network', message: (e as Error).message } };
    }
  },
});

export const hlPerpFundingHistoryTool: HarnessTool = defineTool({
  name: 'get_perp_funding_history',
  description: 'Real historical funding rates for a Hyperliquid perp over a time range (ms timestamps). Defaults to last 24h.',
  category: 'perps',
  parameters: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Coin symbol, e.g. BTC.' },
      startTimeMs: { type: 'number', description: 'Start timestamp ms (default 24h ago).' },
      endTimeMs: { type: 'number', description: 'End timestamp ms (default now).' },
    },
    required: ['symbol'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    try {
      const sym = args.symbol.trim().toUpperCase().replace(/[-_]?(PERP|USDT|USD)$/, '');
      const end = args.endTimeMs ?? Date.now();
      const start = args.startTimeMs ?? end - 24 * 3600 * 1000;
      const rows = await hlInfo<Array<Record<string, unknown>>>({
        type: 'fundingHistory',
        coin: sym,
        startTime: start,
        endTime: end,
      });
      return {
        source: 'hyperliquid',
        symbol: sym,
        history: (rows ?? []).map((r) => ({
          coin: r.coin,
          fundingRatePct: Number(r.fundingRate) * 100,
          premiumPct: Number(r.premium) * 100,
          time: r.time,
        })),
      };
    } catch (e) {
      return { error: { kind: 'network', message: (e as Error).message } };
    }
  },
});

export const hyperliquidTools: HarnessTool[] = [
  hlPerpSnapshotTool,
  hlPerpMarketsTool,
  hlPerpPositionsTool,
  hlPerpFundingHistoryTool,
];
