/**
 * strategy/indicators.ts — small TA helpers operating on Candle arrays.
 *
 * Pure functions, no state. Each returns the most recent value (right edge
 * of the window) so strategies can read "the SMA just before the current
 * bar" without carrying series state themselves.
 */

import type { Candle } from './types.js';

function closes(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}

/** Simple moving average of the last `period` closes. */
export function sma(candles: Candle[], period: number): number {
  if (period <= 0) throw new Error('sma: period must be positive');
  if (candles.length < period) return NaN;
  const slice = closes(candles).slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Exponential moving average (seeded with SMA of the first `period` closes). */
export function ema(candles: Candle[], period: number): number {
  if (period <= 0) throw new Error('ema: period must be positive');
  if (candles.length < period) return NaN;
  const k = 2 / (period + 1);
  const cs = closes(candles);
  let e = cs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < cs.length; i++) e = cs[i] * k + e * (1 - k);
  return e;
}

/** Average True Range over the last `period` bars. */
export function atr(candles: Candle[], period: number): number {
  if (period <= 0) throw new Error('atr: period must be positive');
  if (candles.length < period + 1) return NaN;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    sum += Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  }
  return sum / period;
}

/** Relative Strength Index over the last `period` closes (Wilder's smoothing). */
export function rsi(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) return NaN;
  const cs = closes(candles);
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = cs[i] - cs[i - 1];
    if (diff >= 0) gain += diff; else loss -= diff;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  for (let i = period + 1; i < cs.length; i++) {
    const diff = cs[i] - cs[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Highest high over the last `period` bars. */
export function highest(candles: Candle[], period: number): number {
  if (candles.length < period) return NaN;
  return Math.max(...candles.slice(-period).map((c) => c.high));
}

/** Lowest low over the last `period` bars. */
export function lowest(candles: Candle[], period: number): number {
  if (candles.length < period) return NaN;
  return Math.min(...candles.slice(-period).map((c) => c.low));
}
