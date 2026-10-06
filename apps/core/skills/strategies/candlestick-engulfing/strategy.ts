/**
 * candlestick-engulfing — bullish engulfing pattern after a downtrend,
 * with a stop below the pattern and a 2:1 reward:risk take-profit.
 *
 * Entry requires:
 *   1. Downtrend context: close below SMA(20)
 *   2. Current bar engulfs previous bar (current body fully covers previous body)
 *   3. Previous bar was bearish, current bar is bullish
 *   4. Current body is at least `minBodyPct` of the bar's range (filters doji-ish covers)
 *
 * Exit: engine-driven stop-loss or take-profit. The strategy sets both at entry.
 */

import type { Candle, Strategy } from '../../../src/strategy/types.js';
import { sma } from '../../../src/strategy/indicators.js';

interface BarShape {
  body: number;
  range: number;
  isBull: boolean;
  upperShadow: number;
  lowerShadow: number;
  bodyTop: number;
  bodyBottom: number;
}

function shape(c: Candle): BarShape {
  const bodyTop = Math.max(c.open, c.close);
  const bodyBottom = Math.min(c.open, c.close);
  const body = bodyTop - bodyBottom;
  const range = c.high - c.low;
  return {
    body,
    range,
    isBull: c.close > c.open,
    upperShadow: c.high - bodyTop,
    lowerShadow: bodyBottom - c.low,
    bodyTop,
    bodyBottom,
  };
}

function isBullishEngulfing(prev: Candle, cur: Candle, minBodyPct: number): boolean {
  const p = shape(prev);
  const c = shape(cur);
  if (p.isBull || !c.isBull) return false;
  if (c.range === 0) return false;
  if (c.body / c.range < minBodyPct) return false;
  return c.bodyTop >= p.bodyTop && c.bodyBottom <= p.bodyBottom && c.body > p.body * 1.05;
}

export const strategy: Strategy = {
  name: 'candlestick-engulfing',
  description: 'Bullish engulfing pattern after a downtrend, with stop below the pattern and 2:1 take-profit.',
  timeframe: '1h',
  params: {
    trendPeriod: { type: 'int', default: 20, min: 5, max: 60, description: 'SMA period used to define "downtrend context"' },
    minBodyPct: { type: 'float', default: 0.55, min: 0.3, max: 0.9, description: 'Body must be at least this fraction of the bar range' },
    rewardRisk: { type: 'float', default: 2.0, min: 1.0, max: 4.0, description: 'Take-profit distance = stop distance × this' },
    sizeFraction: { type: 'float', default: 0.4, min: 0.1, max: 1.0, description: 'Fraction of cash to allocate per entry' },
  },
  warmup(p) {
    return Number(p.trendPeriod) + 2;
  },
  onCandle(candles: Candle[], ctx, p) {
    const trendPeriod = Number(p.trendPeriod);
    const minBodyPct = Number(p.minBodyPct);
    const rewardRisk = Number(p.rewardRisk);
    const sizeFraction = Number(p.sizeFraction);
    if (candles.length < trendPeriod + 2) return { kind: 'hold' };

    const trend = sma(candles, trendPeriod);
    if (!Number.isFinite(trend)) return { kind: 'hold' };

    const prev = candles[candles.length - 2];
    const cur = candles[candles.length - 1];

    if (!ctx.position) {
      if (cur.close >= trend) return { kind: 'hold' }; // need downtrend context
      if (!isBullishEngulfing(prev, cur, minBodyPct)) return { kind: 'hold' };
      const stop = Math.min(prev.low, cur.low);
      const risk = cur.close - stop;
      if (risk <= 0) return { kind: 'hold' };
      const tp = cur.close + risk * rewardRisk;
      const notional = ctx.cash * sizeFraction;
      if (notional <= 0) return { kind: 'hold' };
      return {
        kind: 'enter-long',
        notional,
        stopPrice: stop,
        takeProfitPrice: tp,
        reason: `Bullish engulfing after downtrend; stop ${stop.toFixed(2)}, tp ${tp.toFixed(2)} (R:R ${rewardRisk})`,
      };
    }
    return { kind: 'hold' };
  },
};
