import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  existsSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import {
  Config,
  OAuth,
  QuoteContext,
  ContentContext,
  Period,
  AdjustType,
  TradeSessions,
  CalcIndex,
} from 'longbridge';
import { toolContext } from '../runtime/toolContext.js';
import { dataPath } from '../runtime/paths.js';
import { fetchJson } from '../tools/registry.js';
import { getKlinesTool } from '../tools/market-data.js';
import { hlPerpSnapshotTool } from '../tools/hyperliquid.js';
import { cryptoNewsTool } from '../tools/data-sources.js';
import {
  parseInstrument,
  type Instrument,
  type MarketInterval,
  type MarketQuote,
  type Candle,
  type MarketNews,
} from './types.js';

export interface ProviderStatus {
  connected: boolean;
  connecting: boolean;
  authorizationUrl?: string;
  error?: string;
}
export interface MarketProvider {
  search(query: string): Promise<Instrument[]>;
  quote(instrument: Instrument): Promise<MarketQuote>;
  candles(
    instrument: Instrument,
    interval: MarketInterval,
  ): Promise<{ candles: Candle[]; source: string; adjustment: string }>;
  news(instrument: Instrument): Promise<MarketNews[]>;
  fundamentals(instrument: Instrument): Promise<unknown>;
}
const finite = (v: unknown) =>
  v !== null && v !== undefined && Number.isFinite(Number(v))
    ? Number(v)
    : null;
async function json(url: string, init?: RequestInit): Promise<any> {
  const r = await fetchJson(url, init);
  if (!r.ok)
    throw new Error(
      `Market data unavailable (${String(r.error.error.status ?? r.error.error.kind)})`,
    );
  return r.data;
}
async function tool(
  tool: Pick<
    import('../loop/types.js').AgentTool<any, any>,
    'name' | 'execute'
  >,
  args: unknown,
): Promise<any> {
  const result = await tool.execute('market-read', args);
  const data = result.details as any;
  if (data?.error || data?.stub)
    throw new Error(
      data.error?.message ??
        `${tool.name}: ${data.error?.status ? `HTTP ${data.error.status}` : 'data unavailable'}${tool.name === 'get_crypto_news' && data.error?.status === 401 ? '；请配置 CRYPTOCOMPARE_API_KEY' : ''}`,
    );
  return data;
}
async function sdkRead<T>(work: Promise<T>): Promise<T> {
  const signal = toolContext.getStore()?.signal;
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout>;
  let abort: () => void = () => {};
  const boundary = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Longbridge data request timed out')),
      15000,
    );
    abort = () => reject(signal?.reason ?? new Error('Request cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([work, boundary]);
  } finally {
    clearTimeout(timer!);
    signal?.removeEventListener('abort', abort);
  }
}
export function cleanCandles(rows: Candle[]): Candle[] {
  return [
    ...new Map(
      rows
        .filter(
          (c) =>
            c.time > 0 &&
            [c.time, c.open, c.high, c.low, c.close, c.volume].every(
              Number.isFinite,
            ) &&
            c.low > 0 &&
            c.high >= Math.max(c.open, c.close) &&
            c.low <= Math.min(c.open, c.close) &&
            c.volume >= 0,
        )
        .map((c) => [c.time, c]),
    ).values(),
  ]
    .sort((a, b) => a.time - b.time)
    .slice(-500);
}

/** Official SDK owns authentication and quote protocols. No trading context is created. */
export class LongbridgeData {
  private quotes?: QuoteContext;
  private content?: ContentContext;
  private pending?: Promise<void>;
  private state: ProviderStatus = { connected: false, connecting: false };
  status(): ProviderStatus {
    return { ...this.state };
  }
  async connect(): Promise<ProviderStatus> {
    if (this.quotes || this.pending) return this.status();
    this.state = { connected: false, connecting: true };
    this.pending = this.authenticate()
      .catch((e) => {
        this.quotes = undefined;
        this.content = undefined;
        this.state = {
          connected: false,
          connecting: false,
          error: String(e.message ?? e),
        };
      })
      .finally(() => {
        this.pending = undefined;
      });
    // The SDK authorization callback sets the URL; authorization completes independently.
    await Promise.race([
      this.pending,
      new Promise((resolve) => setTimeout(resolve, 700)),
    ]);
    return this.status();
  }
  private async authenticate(): Promise<void> {
    const envKey =
      process.env.LONGBRIDGE_APP_KEY ?? process.env.LONGPORT_APP_KEY;
    let config: Config;
    if (envKey) config = Config.fromApikeyEnv();
    else {
      const file = dataPath('longbridge.json');
      let clientId: string | undefined;
      try {
        clientId = JSON.parse(readFileSync(file, 'utf8')).clientId;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      if (!clientId) {
        const registration = await json(
          'https://openapi.longbridge.com/oauth2/register',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              redirect_uris: ['http://localhost:60355/callback'],
              token_endpoint_auth_method: 'none',
              grant_types: ['authorization_code', 'refresh_token'],
              response_types: ['code'],
              client_name: 'Seris market data',
            }),
          },
        );
        if (typeof registration.client_id !== 'string')
          throw new Error('Unable to register Longbridge authorization');
        clientId = registration.client_id;
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(`${file}.tmp`, JSON.stringify({ clientId }), {
          mode: 0o600,
        });
        renameSync(`${file}.tmp`, file);
      }
      const oauth = await OAuth.build(clientId!, (error, url) => {
        if (error) {
          this.state = {
            connected: false,
            connecting: false,
            error: error.message,
          };
          return;
        }
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          this.state = {
            connected: false,
            connecting: false,
            error: 'Invalid authorization URL',
          };
          return;
        }
        if (
          parsed.protocol !== 'https:' ||
          !/(^|\.)(longbridge\.com|longbridge\.cn|longportapp\.com)$/.test(
            parsed.hostname,
          )
        ) {
          this.state = {
            connected: false,
            connecting: false,
            error: 'Unexpected authorization host',
          };
          return;
        }
        this.state = {
          connected: false,
          connecting: true,
          authorizationUrl: url,
        };
      });
      config = Config.fromOAuth(oauth, { enablePrintQuotePackages: false });
    }
    this.quotes = QuoteContext.new(config);
    this.content = ContentContext.new(config);
    await sdkRead(this.quotes.quoteLevel());
    this.state = { connected: true, connecting: false };
  }
  async context(): Promise<{ quotes: QuoteContext; content: ContentContext }> {
    if (!this.quotes && !this.pending) {
      let clientId: string | undefined;
      try {
        clientId = JSON.parse(
          readFileSync(dataPath('longbridge.json'), 'utf8'),
        ).clientId;
      } catch {}
      if (
        process.env.LONGBRIDGE_APP_KEY ||
        process.env.LONGPORT_APP_KEY ||
        (clientId &&
          existsSync(join(homedir(), '.longbridge/openapi/tokens', clientId)))
      )
        await this.connect();
    }
    if (this.pending && !this.state.authorizationUrl)
      await Promise.race([
        this.pending,
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    if (!this.quotes || !this.content || !this.state.connected)
      throw new Error(
        '美股数据需要连接长桥；请点击 Markets 中的“连接美股数据”。',
      );
    return { quotes: this.quotes, content: this.content };
  }
}
const periods: Record<MarketInterval, Period> = {
  '15m': Period.Min_15,
  '1h': Period.Min_60,
  '4h': Period.Min_60,
  '1d': Period.Day,
  '1w': Period.Week,
};
const intervalMs: Record<MarketInterval, number> = {
  '15m': 900000,
  '1h': 3600000,
  '4h': 14400000,
  '1d': 86400000,
  '1w': 604800000,
};
export class PublicMarketProvider implements MarketProvider {
  readonly longbridge = new LongbridgeData();
  private universe?: { at: number; coins: string[] };
  async search(query: string): Promise<Instrument[]> {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    const results: Instrument[] = [];
    const spotSymbol = q.endsWith('USDT') ? q : `${q}USDT`;
    await Promise.allSettled([
      (async () => {
        try {
          if (!this.universe || Date.now() - this.universe.at > 300000) {
            const meta = await json('https://api.hyperliquid.xyz/info', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ type: 'meta' }),
            });
            this.universe = {
              at: Date.now(),
              coins: meta.universe
                .filter((v: any) => !v.isDelisted)
                .map((v: any) => v.name),
            };
          }
          for (const symbol of this.universe.coins
            .filter((s) => s.includes(q))
            .slice(0, 8)) {
            try {
              results.push(
                parseInstrument({
                  id: `hyperliquid:${symbol}`,
                  symbol,
                  name: `${symbol} Perpetual`,
                  kind: 'crypto',
                  venue: 'hyperliquid',
                  providerSymbol: symbol,
                }),
              );
            } catch {}
          }
        } catch {
          /* Stock search remains usable if a crypto venue is down. */
        }
      })(),
      (async () => {
        try {
          const search = await json(
            `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=12&newsCount=0`,
          );
          for (const row of search.quotes ?? []) {
            if (
              !['EQUITY', 'ETF'].includes(row.quoteType) ||
              !/^[A-Z0-9.-]{1,20}$/.test(row.symbol) ||
              !['NMS', 'NYQ', 'NGM', 'NCM', 'PCX', 'ASE', 'BTS'].includes(
                row.exchange,
              )
            )
              continue;
            results.push({
              id: `us:${row.symbol}.US`,
              symbol: row.symbol,
              name: row.shortname ?? row.longname ?? row.symbol,
              kind: row.quoteType === 'ETF' ? 'etf' : 'stock',
              venue: 'us',
              providerSymbol: `${row.symbol}.US`,
            });
          }
        } catch {
          /* Exact symbols can still be resolved through the authorized SDK. */
        }
      })(),
      (async () => {
        if (!/^[A-Z0-9]{1,20}$/.test(spotSymbol)) return;
        const data = await json(
          `https://api.binance.com/api/v3/exchangeInfo?symbol=${encodeURIComponent(spotSymbol)}`,
        );
        for (const row of data.symbols ?? [])
          if (
            row.status === 'TRADING' &&
            row.isSpotTradingAllowed &&
            row.quoteAsset === 'USDT'
          )
            results.push(
              parseInstrument({
                id: `binance:${row.symbol}`,
                symbol: row.baseAsset,
                name: `${row.baseAsset} / USDT`,
                kind: 'crypto',
                venue: 'binance',
                providerSymbol: row.symbol,
              }),
            );
      })(),
    ]);
    if (
      /^[A-Z][A-Z0-9.-]{0,15}$/.test(q) &&
      !results.some((r) => r.venue === 'us' && r.symbol === q)
    ) {
      const symbol = q.replace(/\.US$/, '');
      results.push({
        id: `us:${symbol}.US`,
        symbol,
        name: `${symbol}（代码查询）`,
        kind: ['SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'GLD', 'TLT'].includes(
          symbol,
        )
          ? 'etf'
          : 'stock',
        venue: 'us',
        providerSymbol: `${symbol}.US`,
      });
    }
    return results.sort((a, b) => a.venue.localeCompare(b.venue)).slice(0, 20);
  }
  async quote(instrument: Instrument): Promise<MarketQuote> {
    if (instrument.venue === 'hyperliquid') {
      const q = await tool(hlPerpSnapshotTool, {
        symbol: instrument.providerSymbol,
      });
      return {
        instrument,
        price: q.markPrice,
        currency: 'USD',
        changePct: q.change24hPct,
        volume: q.volume24hUsd,
        source: 'Hyperliquid',
        priceType: 'mark',
        time: Date.now(),
        fetchedAt: Date.now(),
        changePeriod: '24h',
        fundingHourlyPct: q.fundingRateHourlyPct,
        openInterestUsd: q.openInterestUsd,
      };
    }
    if (instrument.venue === 'binance') {
      const q = await json(
        `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(instrument.providerSymbol)}`,
      );
      return {
        instrument,
        price: Number(q.lastPrice),
        currency: 'USDT',
        changePct: finite(q.priceChangePercent),
        volume: finite(q.quoteVolume),
        source: 'Binance spot',
        priceType: 'last',
        time: Number(q.closeTime),
        fetchedAt: Date.now(),
        changePeriod: '24h',
      };
    }
    const { quotes } = await this.longbridge.context();
    const [q] = await sdkRead(quotes.quote([instrument.providerSymbol]));
    if (!q) throw new Error('Stock quote unavailable');
    const price = Number(q.lastDone.toString()),
      previous = Number(q.prevClose.toString());
    return {
      instrument,
      price,
      currency: 'USD',
      changePct: previous > 0 ? (price / previous - 1) * 100 : null,
      volume: q.volume,
      source: 'Longbridge',
      priceType: 'regular last',
      time: q.timestamp.getTime(),
      fetchedAt: Date.now(),
      changePeriod: 'session',
      session: '常规时段报价',
    };
  }
  async candles(instrument: Instrument, interval: MarketInterval) {
    if (instrument.venue === 'hyperliquid') {
      const end = Date.now();
      const rows = await json('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'candleSnapshot',
          req: {
            coin: instrument.providerSymbol,
            interval,
            startTime: end - intervalMs[interval] * 500,
            endTime: end,
          },
        }),
      });
      return {
        source: 'Hyperliquid',
        adjustment: 'none',
        candles: cleanCandles(
          rows.map((r: any) => ({
            time: Number(r.t) / 1000,
            open: Number(r.o),
            high: Number(r.h),
            low: Number(r.l),
            close: Number(r.c),
            volume: Number(r.v),
          })),
        ),
      };
    }
    if (instrument.venue === 'binance') {
      const data = await tool(getKlinesTool, {
        symbol: instrument.providerSymbol,
        interval,
        limit: 500,
      });
      return {
        source: 'Binance spot',
        adjustment: 'none',
        candles: cleanCandles(
          data.candles.map((r: any) => ({ ...r, time: r.openTime / 1000 })),
        ),
      };
    }
    if (interval === '4h') throw new Error('美股请使用 15m、1h、1d 或 1w 周期');
    const { quotes } = await this.longbridge.context();
    const rows = await sdkRead(
      quotes.candlesticks(
        instrument.providerSymbol,
        periods[interval],
        500,
        AdjustType.ForwardAdjust,
        TradeSessions.Intraday,
      ),
    );
    return {
      source: 'Longbridge',
      adjustment: 'forward-adjusted / regular session',
      candles: cleanCandles(
        rows.map((r) => ({
          time: r.timestamp.getTime() / 1000,
          open: Number(r.open.toString()),
          high: Number(r.high.toString()),
          low: Number(r.low.toString()),
          close: Number(r.close.toString()),
          volume: r.volume,
        })),
      ),
    };
  }
  async news(instrument: Instrument): Promise<MarketNews[]> {
    if (instrument.venue !== 'us') {
      const data = await tool(cryptoNewsTool, {
        categories: instrument.symbol,
        limit: 12,
      });
      return data.news.map((r: any) => ({
        ...r,
        publishedAt: r.publishedAt * 1000,
      }));
    }
    const { content } = await this.longbridge.context();
    return (await sdkRead(content.news(instrument.providerSymbol)))
      .slice(0, 12)
      .map((r) => ({
        title: r.title,
        url: r.url,
        source: 'Longbridge',
        publishedAt: r.publishedAt.getTime(),
        summary: r.description,
      }));
  }
  async fundamentals(instrument: Instrument) {
    if (instrument.venue !== 'us')
      throw new Error('Company fundamentals require a stock or ETF');
    const { quotes } = await this.longbridge.context();
    const [info, indexes, filings] = await Promise.allSettled([
      sdkRead(quotes.staticInfo([instrument.providerSymbol])),
      sdkRead(
        quotes.calcIndexes(
          [instrument.providerSymbol],
          [
            CalcIndex.TotalMarketValue,
            CalcIndex.PeTtmRatio,
            CalcIndex.PbRatio,
            CalcIndex.DividendRatioTtm,
            CalcIndex.YtdChangeRate,
          ],
        ),
      ),
      sdkRead(quotes.filings(instrument.providerSymbol)),
    ]);
    const result = (r: PromiseSettledResult<any>) =>
      r.status === 'fulfilled'
        ? r.value.slice(0, 20).map((v: any) => v.toJSON())
        : { unavailable: true };
    return {
      instrument,
      source: 'Longbridge',
      fetchedAt: Date.now(),
      company: result(info),
      valuation: result(indexes),
      filings: result(filings),
      warnings: [info, indexes, filings].flatMap((r, i) =>
        r.status === 'rejected'
          ? [`${['company', 'valuation', 'filings'][i]} unavailable`]
          : [],
      ),
    };
  }
}
