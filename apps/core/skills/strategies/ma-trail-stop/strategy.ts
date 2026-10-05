/**
 * ma-trail-stop — dual MA crossover entry with an explicit trailing stop.
 *
 * Entry: long when fast MA crosses above slow MA. Position size is a
 * configurable fraction of current cash. Initial stop sits `atrMultiple`
 * ATRs below entry.
 *
 * Trail: as the price moves above breakeven, the stop ratchets up to
 * `trailAtrMultiple` ATRs below the highest close since entry. The stop is
 * moved via an `adjust-stop` signal each bar — the engine fills the exit
 * the moment a bar's low crosses it, regardless of what onCandle returned.
 *
 * Exit: engine-triggered stop fill, or a fast-below-slow death cross.
 */

import type { Candle, Strategy } from '@seris/strategy';
import { atr, highest, sma } from '@seris/strategy';

export const strategy: Strategy = {
  name: 'ma-trail-stop',
  description: 'Dual moving-average crossover long entry with ATR trailing stop.',
  timeframe: '1h',
  params: {
    fast: { type: 'int', default: 10, min: 3, max: 50, description: 'Fast SMA period' },
    slow: { type: 'int', default: 30, min: 10, max: 200, description: 'Slow SMA period' },
    atrPeriod: { type: 'int', default: 14, min: 5, max: 50, description: 'ATR period' },
    atrMultiple: { type: 'float', default: 2.0, min: 0.5, max: 6, description: 'Initial stop distance in ATRs' },
    trailAtrMultiple: { type: 'float', default: 1.5, min: 0.5, max: 6, description: 'Trailing stop distance in ATRs once price moves above entry' },
    sizeFraction: { type: 'float', default: 0.5, min: 0.05, max: 1.0, description: 'Fraction of cash to allocate per entry' },
  },
  warmup(p) {
    const slow = Number(p.slow);
    const atrPeriod = Number(p.atrPeriod);
    return Math.max(slow, atrPeriod + 1) + 1;
  },
  onCandle(candles: Candle[], ctx, p) {
    const fast = Number(p.fast);
    const slow = Number(p.slow);
    const atrPeriod = Number(p.atrPeriod);
    const atrMultiple = Number(p.atrMultiple);
    const trailAtrMultiple = Number(p.trailAtrMultiple);
    const sizeFraction = Number(p.sizeFraction);

    if (candles.length < Math.max(slow, atrPeriod + 1) + 1) return { kind: 'hold' };

    const bar = candles[candles.length - 1];
    const prevBar = candles[candles.length - 2];
    const fastNow = sma(candles, fast);
    const slowNow = sma(candles, slow);
    const fastPrev = sma(candles.slice(0, -1), fast);
    const slowPrev = sma(candles.slice(0, -1), slow);
    const a = atr(candles, atrPeriod);

    if (!Number.isFinite(fastNow) || !Number.isFinite(slowNow) || !Number.isFinite(a)) {
      return { kind: 'hold' };
    }

    // Already long: trail the stop and check exit cross
    if (ctx.position?.side === 'long') {
      // Ratchet the stop up only. The engine ignores moves that would lower it.
      const entryIdx = ctx.fills.findLastIndex((f) => f.via === 'signal' && f.side === 'buy');
      const entryTime = entryIdx >= 0 ? ctx.fills[entryIdx].time : ctx.position.openedAt;
      const sinceEntry = candles.filter((c) => c.time >= entryTime);
      const peak = sinceEntry.length > 0 ? highest(sinceEntry, sinceEntry.length) : bar.close;
      const trailStop = peak - trailAtrMultiple * a;
      const currentStop = ctx.stopPrice ?? 0;
      const crossDown = fastPrev >= slowPrev && fastNow < slowNow;

      if (crossDown) {
        return { kind: 'exit', reason: `MA${fast} crossed below MA${slow}` };
      }
      if (trailStop > currentStop && trailStop < bar.close) {
        return {
          kind: 'adjust-stop',
          stopPrice: trailStop,
          reason: `trail stop to ${trailStop.toFixed(2)} (${trailAtrMultiple}x ATR below peak ${peak.toFixed(2)})`,
        };
      }
      return { kind: 'hold' };
    }

    // Flat: look for a bullish cross to enter
    const crossUp = fastPrev <= slowPrev && fastNow > slowNow;
    if (crossUp && ctx.cash > 0) {
      const notional = ctx.cash * sizeFraction;
      if (notional <= 0) return { kind: 'hold' };
      const stop = bar.close - atrMultiple * a;
      return {
        kind: 'enter-long',
        notional,
        stopPrice: stop,
        reason: `MA${fast} crossed above MA${slow}; initial stop ${stop.toFixed(2)} (${atrMultiple}x ATR)`,
      };
    }
    void prevBar;
    return { kind: 'hold' };
  },
};
