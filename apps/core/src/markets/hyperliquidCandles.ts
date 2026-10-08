import { fetchJson } from '../tools/registry.js';
import type { Candle, Timeframe } from '../strategy/types.js';

/** Shared by market charts (seconds) and backtests (milliseconds). */
export async function hyperliquidCandles(opts: {
  coin: string;
  interval: Timeframe;
  startTime: number;
  endTime: number;
  signal?: AbortSignal;
}): Promise<(Candle & { closeTime: number })[]> {
  const { signal, ...req } = opts;
  const response = await fetchJson('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'candleSnapshot', req }),
    signal,
    timeoutMs: 30_000,
  });
  if (!response.ok) throw new Error(`Hyperliquid candles unavailable: ${JSON.stringify(response.error.error)}`);
  if (!Array.isArray(response.data)) throw new Error('Invalid Hyperliquid candle response');
  return response.data.map((r: Record<string, unknown>) => {
    if (!r || r.s !== opts.coin || r.i !== opts.interval) throw new Error('Hyperliquid candle instrument/interval mismatch');
    const candle = {
      time: Number(r.t), closeTime: Number(r.T), open: Number(r.o),
      high: Number(r.h), low: Number(r.l), close: Number(r.c), volume: Number(r.v),
    };
    if (!Object.values(candle).every(Number.isFinite) || candle.time <= 0 || candle.closeTime < candle.time
      || candle.low <= 0 || candle.high < Math.max(candle.open, candle.close, candle.low)
      || candle.low > Math.min(candle.open, candle.close) || candle.volume < 0) {
      throw new Error('Invalid Hyperliquid candle values');
    }
    return candle;
  });
}
