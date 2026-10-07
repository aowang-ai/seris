import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dataPath } from '../runtime/paths.js';
import {
  getAutopilotEngine,
  type AutopilotEngine,
} from '../autopilot/engine.js';
import { PublicMarketProvider, type MarketProvider } from './providers.js';
import { instrumentFromId, normalizeInstrument } from './instruments.js';
import {
  parseInstrument,
  parseInterval,
  parseContextInput,
  parseRule,
  type Instrument,
  type MarketInterval,
  type MarketQuote,
  type MarketChart,
  type MarketContext,
  type MarketContextInput,
  type MarketRule,
  type MarketAlert,
  type MarketNotification,
} from './types.js';

export const DEFAULT_WATCHLIST: Instrument[] = [
  ...['BTC', 'ETH', 'SOL'].map((symbol) => ({
    id: `hyperliquid:${symbol}`,
    symbol,
    name: `${symbol} Perpetual`,
    kind: 'crypto' as const,
    venue: 'hyperliquid' as const,
    providerSymbol: symbol,
  })),
  ...[
    ['NVDA', 'NVIDIA', 'stock'],
    ['AAPL', 'Apple', 'stock'],
    ['SPY', 'SPDR S&P 500 ETF', 'etf'],
  ].map(([symbol, name, kind]) => ({
    id: `us:${symbol}.US`,
    symbol,
    name,
    kind: kind as 'stock' | 'etf',
    venue: 'us' as const,
    providerSymbol: `${symbol}.US`,
  })),
];
function save(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
  renameSync(temporary, file);
}
export class MarketService {
  private instruments: Instrument[];
  private cache = new Map<string, { expires: number; value: unknown }>();
  private pending = new Map<string, Promise<any>>();
  private snapshots = new Map<string, MarketChart>();
  private searched = new Map<string, Instrument>();
  readonly provider: MarketProvider;
  readonly engine: AutopilotEngine;
  constructor(
    private readonly file = dataPath('markets/watchlist.json'),
    provider: MarketProvider = new PublicMarketProvider(),
    engine = getAutopilotEngine(),
  ) {
    this.provider = provider;
    this.engine = engine;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (!Array.isArray(data) || data.length > 50)
        throw new Error('Invalid watchlist');
      this.instruments = data.map(normalizeInstrument);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      this.instruments = structuredClone(DEFAULT_WATCHLIST);
    }
  }
  watchlist(): Instrument[] {
    return structuredClone(this.instruments);
  }
  add(value: unknown): Instrument[] {
    const instrument = normalizeInstrument(value);
    if (!this.instruments.some((i) => i.id === instrument.id)) {
      if (this.instruments.length >= 50)
        throw new Error('Watchlist supports at most 50 instruments');
      const next = [...this.instruments, instrument];
      save(this.file, next);
      this.instruments = next;
    }
    return this.watchlist();
  }
  remove(id: string): Instrument[] {
    const next = this.instruments.filter((i) => i.id !== id);
    save(this.file, next);
    this.instruments = next;
    return this.watchlist();
  }
  instrument(id: string): Instrument {
    const known = this.instruments.find((i) => i.id === id) ?? this.searched.get(id);
    if (known) return { ...known };
    return instrumentFromId(id);
  }
  async search(query: string): Promise<Instrument[]> {
    const results = await this.provider.search(query);
    for (const result of results) {
      // A malformed enrichment must not hide other search results.
      let instrument: Instrument;
      try { instrument = parseInstrument(result); } catch { continue; }
      this.searched.set(instrument.id, instrument);
      if (this.searched.size > 200) this.searched.delete(this.searched.keys().next().value!);
    }
    return structuredClone(results);
  }
  private cached<T>(
    key: string,
    ttl: number,
    read: () => Promise<T>,
  ): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now())
      return Promise.resolve(structuredClone(hit.value) as T);
    const pending = this.pending.get(key);
    if (pending) return pending.then((value) => structuredClone(value) as T);
    const promise = read()
      .then((value) => {
        this.cache.set(key, { expires: Date.now() + ttl, value });
        if (this.cache.size > 200)
          this.cache.delete(this.cache.keys().next().value!);
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise.then((value) => structuredClone(value));
  }
  quote(instrument: Instrument): Promise<MarketQuote> {
    return this.cached(`quote:${instrument.id}`, 30000, async () => {
      const q = await this.provider.quote(instrument);
      if (
        !Number.isFinite(q.price) ||
        q.price <= 0 ||
        !Number.isFinite(q.time) ||
        q.time <= 0
      )
        throw new Error('Invalid market quote');
      return q;
    });
  }
  async quotes(): Promise<
    Array<{ instrument: Instrument; quote?: MarketQuote; error?: string }>
  > {
    // Small bounded batches share cached reads with charts and monitors.
    const rows = [];
    for (let i = 0; i < this.instruments.length; i += 4)
      rows.push(
        ...(await Promise.all(
          this.instruments.slice(i, i + 4).map(async (instrument) => {
            try {
              return { instrument, quote: await this.quote(instrument) };
            } catch (e) {
              return { instrument, error: (e as Error).message };
            }
          }),
        )),
      );
    return rows;
  }
  chart(value: Instrument, period: MarketInterval): Promise<MarketChart> {
    const instrument = parseInstrument(value),
      interval = parseInterval(period);
    return this.cached<MarketChart>(
      `chart:${instrument.id}:${interval}`,
      60000,
      async () => {
        const [data, quote] = await Promise.all([
          this.provider.candles(instrument, interval),
          this.quote(instrument),
        ]);
        if (!data.candles.length)
          throw new Error('No candles available for this market');
        const body = {
          instrument,
          interval,
          ...data,
          quote,
          fetchedAt: Date.now(),
        };
        const id = createHash('sha256')
          .update(JSON.stringify(body))
          .digest('hex');
        return { id, ...body };
      },
    ).then((chart) => {
      this.snapshots.set(chart.id, chart);
      if (this.snapshots.size > 200)
        this.snapshots.delete(this.snapshots.keys().next().value!);
      return chart;
    });
  }
  snapshot(id: string): MarketChart {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid market snapshot');
    const cached = this.snapshots.get(id);
    if (cached) return structuredClone(cached);
    try {
      const data = JSON.parse(
        readFileSync(
          join(dirname(this.file), 'snapshots', `${id}.json`),
          'utf8',
        ),
      );
      const { id: stored, ...body } = data;
      if (
        stored !== id ||
        createHash('sha256').update(JSON.stringify(body)).digest('hex') !== id
      )
        throw new Error('Market snapshot integrity check failed');
      return data;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error(
          'Chart snapshot expired; refresh the chart before sending',
        );
      throw e;
    }
  }
  capture(value: MarketContextInput, persist = true): MarketContext {
    const input = parseContextInput(value),
      chart = this.snapshot(input.dataRef);
    const first = chart.candles[0].time,
      last = chart.candles.at(-1)!.time;
    for (const range of [input.visibleRange, input.selectedRange])
      if (range && (range.to < first || range.from > last))
        throw new Error('Selected range has no chart data');
    if (persist)
      save(join(dirname(this.file), 'snapshots', `${chart.id}.json`), chart);
    return {
      ...input,
      instrument: chart.instrument,
      interval: chart.interval,
      quote: chart.quote,
      fetchedAt: chart.fetchedAt,
      source: chart.source,
      adjustment: chart.adjustment,
    };
  }
  async news(instrument: Instrument) {
    return this.cached(`news:${instrument.id}`, 300000, () =>
      this.provider.news(instrument),
    );
  }
  async fundamentals(instrument: Instrument) {
    return this.cached(`fundamentals:${instrument.id}`, 300000, () =>
      this.provider.fundamentals(instrument),
    );
  }
  alerts(): MarketAlert[] {
    return this.engine
      .list()
      .filter((s) => s.params.marketRule)
      .map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        rule: s.params.marketRule as MarketRule,
        lastRunAt: s.lastRunAt,
        error: s.history[0]?.error,
        lastSummary: s.history[0]?.summary,
        lastObservation: s.history[0]?.observed?.metric as number | undefined,
      }));
  }
  createAlert(value: unknown, requestId?: string): MarketAlert {
    const rule = parseRule(value);
    if (requestId && !/^[\w-]{8,80}$/.test(requestId))
      throw new Error('Invalid alert request ID');
    const existing =
      requestId &&
      this.engine.list().find((s) => s.params.requestId === requestId);
    if (existing) {
      if (JSON.stringify(existing.params.marketRule) !== JSON.stringify(rule))
        throw new Error('Alert request ID reused with different conditions');
      return this.alerts().find((a) => a.id === existing.id)!;
    }
    if (this.alerts().filter((a) => a.status !== 'closed').length >= 50)
      throw new Error('最多支持 50 个未关闭提醒');
    const units =
      rule.metric === 'price'
        ? ['binance', 'binance-tradifi'].includes(rule.instrument.venue)
          ? 'USDT'
          : 'USD'
        : rule.metric === 'fundingHourlyPct'
          ? '% / hr'
          : '%';
    const name = `${rule.instrument.symbol} ${rule.metric} ${rule.direction === 'above' ? '≥' : '≤'} ${rule.threshold} ${units}`;
    const strategy = this.engine.register({
      name,
      description: name,
      kind: 'alert',
      symbol: rule.instrument.symbol,
      intervalMs: 60000,
      params: { marketRule: rule, ...(requestId ? { requestId } : {}) },
    });
    this.engine.start();
    return this.alerts().find((a) => a.id === strategy.id)!;
  }
  setAlert(id: string, status: MarketAlert['status']): MarketAlert {
    if (
      !['active', 'paused', 'closed'].includes(status) ||
      !this.alerts().some((a) => a.id === id)
    )
      throw new Error('Unknown alert or status');
    this.engine.setStatus(id, status);
    return this.alerts().find((a) => a.id === id)!;
  }
  notifications(): MarketNotification[] {
    return this.engine
      .list()
      .filter((s) => s.params.marketRule)
      .flatMap((s) =>
        s.history
          .filter((r) => r.notified?.length)
          .map((r) => ({
            id: `${s.id}:${r.runAt}`,
            alertId: s.id,
            instrument: (s.params.marketRule as MarketRule).instrument,
            time: r.runAt,
            text: r.notified!.join('\n'),
            quote: r.observed?.quote as MarketQuote | undefined,
          })),
      )
      .sort((a, b) => b.time - a.time)
      .slice(0, 100);
  }
  async observeRule(rule: MarketRule) {
    const quote = await this.quote(rule.instrument);
    // Closed-market regular quotes are retained for display, never evaluated as fresh ticks.
    const age = Date.now() - quote.time;
    if (rule.instrument.venue === 'us' && age > 300000)
      return { monitoring: '等待新鲜的常规时段报价，本次不判断', quote };
    if (age > 300000) throw new Error('行情已过期，本次不检查提醒条件');
    const metric =
      rule.metric === 'price'
        ? quote.price
        : rule.metric === 'changePct'
          ? quote.changePct
          : quote.fundingHourlyPct;
    if (metric === undefined || metric === null || !Number.isFinite(metric))
      throw new Error('提醒所需指标不可用');
    return { metric, quote };
  }
}
let singleton: MarketService | undefined;
let singletonFile = '';
export function getMarketService(): MarketService {
  const file = dataPath('markets/watchlist.json');
  if (!singleton || singletonFile !== file) {
    singleton = new MarketService(file);
    singletonFile = file;
  }
  return singleton;
}
