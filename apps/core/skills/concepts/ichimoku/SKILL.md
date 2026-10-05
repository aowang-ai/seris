---
name: concept-ichimoku
description: The Ichimoku five-line system — Tenkan / Kijun / Senkou A / Senkou B / Chikou. Trend filter, cloud breakout entries, and TK cross signals. Includes a TS reference implementation.
metadata:
  seris:
    priority: 24
    tool_names: [strategy_get, strategy_backtest, strategy_backtest_history]
---

# Ichimoku Kinko Hyo

## The five lines

Ichimoku is a self-contained trend system. Five lines, computed entirely from past OHLC, no external inputs:

| Line | Formula | Default period | Use |
|---|---|---|---|
| **Tenkan** (conversion) | (highest high + lowest low) / 2 | 9 | Short-term trend |
| **Kijun** (base) | (highest high + lowest low) / 2 | 26 | Mid-term trend, classic stop |
| **Senkou A** | (Tenkan + Kijun) / 2, plotted 26 bars ahead | derived | Front of the cloud |
| **Senkou B** | (highest high + lowest low) / 2, plotted 26 bars ahead | 52 | Back of the cloud |
| **Chikou** | Close plotted 26 bars *back* | — | Confirmation vs. past price |

The space between Senkou A and Senkou B is **the cloud (kumo)**. When Senkou A > Senkou B the cloud is bullish, otherwise bearish.

## The three classic signals (in order of strength)

1. **Price vs. cloud.** Close above the cloud = bullish regime, below = bearish. The single most reliable filter.
2. **TK cross.** Tenkan crosses Kijun. Up = buy signal, down = sell. Strong *only* when price is on the same side of the cloud.
3. **Chikou confirmation.** Current close above the close 26 bars ago = bullish confirmation.

A "full-strength" long setup: close above cloud, TK bullish cross, chikou above past close. All three agreeing is rare but high-conviction.

## Reference implementation shape

The strategy needs the last 52 + 26 = 78 bars to compute Senkou B's plotted position. Don't skimp on `warmup`.

```typescript
import type { Candle, Strategy } from '@seris/strategy';
import { highest, lowest } from '@seris/strategy';

function midpoint(candles: Candle[], period: number): number {
  return (highest(candles, period) + lowest(candles, period)) / 2;
}

export const strategy: Strategy = {
  name: 'ichimoku-tk-cross',
  timeframe: '4h',
  params: {
    tenkan: { type: 'int', default: 9, min: 5, max: 30 },
    kijun: { type: 'int', default: 26, min: 10, max: 60 },
    senkouB: { type: 'int', default: 52, min: 26, max: 120 },
    sizeFraction: { type: 'float', default: 0.5, min: 0.1, max: 1 },
  },
  warmup: (p) => Number(p.senkouB) + Number(p.kijun),
  onCandle(candles, ctx, p) {
    const tenkan = Number(p.tenkan);
    const kijun = Number(p.kijun);
    const senkouB = Number(p.senkouB);
    const sizeFraction = Number(p.sizeFraction);

    if (candles.length < senkouB + kijun) return { kind: 'hold' };

    const t = midpoint(candles, tenkan);
    const k = midpoint(candles, kijun);
    const tPrev = midpoint(candles.slice(0, -1), tenkan);
    const kPrev = midpoint(candles.slice(0, -1), kijun);

    // Cloud values plotted kijun bars *ahead* of the bar that computed them.
    // To compare against today's close, use the cloud as of `kijun` bars ago.
    const saPast = (midpoint(candles.slice(0, -kijun), tenkan) + midpoint(candles.slice(0, -kijun), kijun)) / 2;
    const sbPast = midpoint(candles.slice(0, -kijun), senkouB);
    const cloudTop = Math.max(saPast, sbPast);
    const cloudBottom = Math.min(saPast, sbPast);

    const bar = candles[candles.length - 1];
    const above = bar.close > cloudTop;
    const below = bar.close < cloudBottom;
    const tkCrossUp = tPrev <= kPrev && t > k;
    const tkCrossDown = tPrev >= kPrev && t < k;

    if (!ctx.position && above && tkCrossUp) {
      const notional = ctx.cash * sizeFraction;
      if (notional > 0) {
        return { kind: 'enter-long', notional, stopPrice: k, reason: `TK cross above cloud; Kijun stop ${k.toFixed(2)}` };
      }
    }
    if (ctx.position && (tkCrossDown || below)) {
      return { kind: 'exit', reason: tkCrossDown ? 'TK cross down' : 'close below cloud' };
    }
    return { kind: 'hold' };
  },
};
```

## Failure modes

- **Trading TK crosses inside the cloud** — this is the most common mistake. Inside the cloud the signals are noise; only trade when the price is clearly above/below.
- **Lower timeframe** — Ichimoku was designed for daily. On 1h and below it's noisy. Default to 4h or 1d.
- **Chikou confirmation against a *visibly* different past** — if the past 26 bars contain a parabolic move, the chikou comparison is meaningless. Eyeball the chart first.
