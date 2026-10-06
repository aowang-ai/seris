/**
 * ratio-mean-reversion — long when the price/SMA ratio is statistically cheap,
 * flat when the ratio recovers.
 *
 * This is the single-instrument spirit of pair trading: instead of trading two
 * legs against each other, treat the "price relative to its own recent mean" as
 * the spread, and bet on its mean-reversion. See `concept-pair-trading` for the
 * (current) limits of running a real two-legged pair trade in this engine.
 *
 * Signal:
 *   ratio_t = close_t / SMA(close, lookback)
 *   z_t = (ln(ratio_t) − SMA(ln(ratio), lookback)) / std(ln(ratio), lookback)
 *
 * Enter long when z < −zEntry, exit when z crosses above zExit (usually 0).
 * Optional hard stop at a fixed % below entry for crash protection.
 */

import type { Candle, Strategy } from '../../../src/strategy/types.js';

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}
function std(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export const strategy: Strategy = {
  name: 'ratio-mean-reversion',
  description: 'Long when price/SMA ratio is cheap (z-score below threshold), exit when the ratio recovers.',
  timeframe: '4h',
  params: {
    lookback: { type: 'int', default: 60, min: 20, max: 200, description: 'Window for the mean and z-score' },
    zEntry: { type: 'float', default: -2.0, min: -4, max: 0, description: 'Enter long when z drops below this' },
    zExit: { type: 'float', default: 0.0, min: -1, max: 2, description: 'Exit when z crosses above this' },
    hardStopPct: { type: 'float', default: 0.08, min: 0.02, max: 0.20, description: 'Hard stop below entry (fraction)' },
    sizeFraction: { type: 'float', default: 0.5, min: 0.1, max: 1.0 },
  },
  warmup(p) {
    return Number(p.lookback) * 2 + 2;
  },
  onCandle(candles: Candle[], ctx, p) {
    const lookback = Number(p.lookback);
    const zEntry = Number(p.zEntry);
    const zExit = Number(p.zExit);
    const hardStopPct = Number(p.hardStopPct);
    const sizeFraction = Number(p.sizeFraction);
    if (candles.length < lookback * 2 + 1) return { kind: 'hold' };

    // Build "spread" series: ln(close / SMA(close, lookback)) for the trailing window
    const ratios: number[] = [];
    for (let end = candles.length - lookback; end <= candles.length; end++) {
      const windowSlice = candles.slice(end - lookback, end);
      const sma = mean(windowSlice.map((c) => c.close));
      if (sma > 0) ratios.push(Math.log(candles[end - 1].close / sma));
    }
    if (ratios.length < lookback) return { kind: 'hold' };
    const mu = mean(ratios);
    const sigma = std(ratios);
    if (!Number.isFinite(mu) || !Number.isFinite(sigma) || sigma === 0) return { kind: 'hold' };
    const z = (ratios[ratios.length - 1] - mu) / sigma;

    if (!ctx.position && z < zEntry) {
      const notional = ctx.cash * sizeFraction;
      if (notional <= 0) return { kind: 'hold' };
      const stop = candles[candles.length - 1].close * (1 - hardStopPct);
      return {
        kind: 'enter-long',
        notional,
        stopPrice: stop,
        reason: `Ratio z=${z.toFixed(2)} < ${zEntry}; mean-reversion long, stop ${stop.toFixed(2)}`,
      };
    }
    if (ctx.position && z > zExit) {
      return { kind: 'exit', reason: `Ratio z=${z.toFixed(2)} recovered past ${zExit}` };
    }
    return { kind: 'hold' };
  },
};
