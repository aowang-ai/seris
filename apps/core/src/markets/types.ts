/** Shared Markets contracts. This module has no server or chart-library imports. */
export const MARKET_INTERVALS = ['15m', '1h', '4h', '1d', '1w'] as const;
export type MarketInterval = (typeof MARKET_INTERVALS)[number];
export interface Instrument {
  id: string;
  symbol: string;
  name: string;
  kind: 'crypto' | 'stock' | 'etf';
  venue: 'hyperliquid' | 'binance' | 'us';
  providerSymbol: string;
}
export interface MarketQuote {
  instrument: Instrument;
  price: number;
  currency: 'USD' | 'USDT';
  changePct: number | null;
  volume: number | null;
  source: string;
  priceType: string;
  time: number;
  fetchedAt: number;
  changePeriod: '24h' | 'session';
  session?: string;
  fundingHourlyPct?: number;
  openInterestUsd?: number;
}
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export interface MarketChart {
  id: string;
  instrument: Instrument;
  interval: MarketInterval;
  source: string;
  fetchedAt: number;
  candles: Candle[];
  quote: MarketQuote;
  adjustment: string;
}
export interface TimeRange {
  from: number;
  to: number;
}
export interface PriceAnnotation {
  price: number;
  label: string;
}
export interface MarketContext {
  viewId: string;
  dataRef: string;
  instrument: Instrument;
  interval: MarketInterval;
  annotations?: PriceAnnotation[];
  visibleRange?: TimeRange;
  selectedRange?: TimeRange;
  quote: MarketQuote;
  fetchedAt: number;
  source: string;
  adjustment: string;
}
export interface MarketContextInput {
  viewId: string;
  dataRef: string;
  annotations?: PriceAnnotation[];
  visibleRange?: TimeRange;
  selectedRange?: TimeRange;
}
export interface MarketAction {
  id: string;
  kind: 'view' | 'price-line';
  /** Absent when a view is opened from Chat without an attached chart. */
  originViewId?: string;
  context: MarketContext;
  label: string;
  price?: number;
}
export interface MarketNews {
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  summary?: string;
}
export interface MarketRule {
  instrument: Instrument;
  metric: 'price' | 'changePct' | 'fundingHourlyPct';
  direction: 'above' | 'below';
  threshold: number;
  once: boolean;
}
export interface MarketAlert {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'closed';
  rule: MarketRule;
  lastRunAt?: number;
  error?: string;
  lastObservation?: number;
  lastSummary?: string;
}
export interface MarketNotification {
  id: string;
  alertId: string;
  instrument: Instrument;
  time: number;
  text: string;
  quote?: MarketQuote;
}
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
export function isInstrument(v: unknown): v is Instrument {
  if (
    !object(v) ||
    !['crypto', 'stock', 'etf'].includes(v.kind) ||
    !['hyperliquid', 'binance', 'us'].includes(v.venue)
  )
    return false;
  if (
    ![v.id, v.symbol, v.name, v.providerSymbol].every(
      (s) => typeof s === 'string' && s.length > 0 && s.length <= 120,
    )
  )
    return false;
  if (v.venue === 'us')
    return (
      v.kind !== 'crypto' &&
      /^[A-Z0-9.-]{1,24}\.US$/.test(v.providerSymbol) &&
      v.id === `us:${v.providerSymbol}`
    );
  return (
    v.kind === 'crypto' &&
    /^[A-Z0-9]{1,24}$/.test(v.providerSymbol) &&
    v.id === `${v.venue}:${v.providerSymbol}`
  );
}
export function parseInstrument(v: unknown): Instrument {
  if (!isInstrument(v)) throw new Error('Invalid market instrument');
  return {
    id: v.id,
    symbol: v.symbol,
    name: v.name,
    kind: v.kind,
    venue: v.venue,
    providerSymbol: v.providerSymbol,
  };
}
export function parseInterval(v: unknown): MarketInterval {
  if (!MARKET_INTERVALS.includes(v as MarketInterval))
    throw new Error('Unsupported chart interval');
  return v as MarketInterval;
}
export function parseRange(v: unknown): TimeRange | undefined {
  if (v === undefined) return;
  if (
    !object(v) ||
    !finite(v.from) ||
    !finite(v.to) ||
    v.from <= 0 ||
    v.to < v.from ||
    v.to > 10_000_000_000
  )
    throw new Error('Invalid chart time range');
  return { from: v.from, to: v.to };
}
function parseAnnotations(v: unknown): PriceAnnotation[] | undefined {
  if (v === undefined) return;
  if (
    !Array.isArray(v) ||
    v.length > 50 ||
    v.some(
      (a) =>
        !object(a) ||
        !finite(a.price) ||
        a.price <= 0 ||
        typeof a.label !== 'string' ||
        a.label.length > 80,
    )
  )
    throw new Error('Invalid chart annotations');
  return v.map((a) => ({ price: a.price, label: a.label }));
}
export function parseContextInput(v: unknown): MarketContextInput {
  if (
    !object(v) ||
    typeof v.viewId !== 'string' ||
    typeof v.dataRef !== 'string' ||
    !/^[\w-]{1,80}$/.test(v.viewId) ||
    !/^[a-f0-9]{64}$/.test(v.dataRef)
  )
    throw new Error('Invalid market context');
  return {
    viewId: v.viewId,
    dataRef: v.dataRef,
    visibleRange: parseRange(v.visibleRange),
    selectedRange: parseRange(v.selectedRange),
    ...(v.annotations === undefined
      ? {}
      : { annotations: parseAnnotations(v.annotations) }),
  };
}
export function parseRule(v: unknown): MarketRule {
  if (
    !object(v) ||
    !['price', 'changePct', 'fundingHourlyPct'].includes(v.metric) ||
    !['above', 'below'].includes(v.direction) ||
    !finite(v.threshold) ||
    (v.once !== undefined && typeof v.once !== 'boolean')
  )
    throw new Error('Invalid alert condition');
  const instrument = parseInstrument(v.instrument);
  if (v.metric === 'price' && v.threshold <= 0)
    throw new Error('Price must be positive');
  if (v.metric === 'fundingHourlyPct' && instrument.venue !== 'hyperliquid')
    throw new Error('Funding alerts require a Hyperliquid perpetual');
  return {
    instrument,
    metric: v.metric,
    direction: v.direction,
    threshold: v.threshold,
    once: v.once !== false,
  };
}
export function isMarketContext(v: unknown): v is MarketContext {
  if (
    !object(v) ||
    !isInstrument(v.instrument) ||
    !object(v.quote) ||
    !finite(v.quote.price) ||
    !finite(v.quote.time) ||
    v.quote.instrument?.id !== v.instrument.id
  )
    return false;
  try {
    parseContextInput(v);
    parseInterval(v.interval);
    return (
      typeof v.source === 'string' &&
      finite(v.fetchedAt) &&
      typeof v.adjustment === 'string'
    );
  } catch {
    return false;
  }
}
export function isMarketAction(v: unknown): v is MarketAction {
  return (
    object(v) &&
    typeof v.id === 'string' &&
    (v.originViewId === undefined || typeof v.originViewId === 'string') &&
    typeof v.label === 'string' &&
    ['view', 'price-line'].includes(v.kind) &&
    isMarketContext(v.context) &&
    (v.kind !== 'price-line' ||
      (typeof v.originViewId === 'string' && finite(v.price) && v.price > 0))
  );
}
export function contextLabel(c: MarketContext): string {
  return `${c.instrument.symbol} · ${c.instrument.venue === 'hyperliquid' ? '永续' : c.instrument.venue === 'binance' ? '现货' : c.instrument.kind === 'etf' ? 'ETF' : '美股'} · ${c.interval}`;
}
