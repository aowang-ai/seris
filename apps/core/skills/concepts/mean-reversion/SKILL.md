---
name: concept-mean-reversion
description: When to use mean reversion instead of momentum. Entry triggers, position sizing, and exit rules for "price deviates from its average, snap back" strategies. Includes a TS reference implementation of RSI-based reversion.
metadata:
  seris:
    priority: 20
    tool_names: [strategy_get, strategy_backtest, strategy_backtest_history]
---

# Mean reversion

## When it applies

Mean reversion assumes the price has an equilibrium value and that deviations from it are temporary. It is the opposite of momentum ("the move continues").

Signs the regime favours mean reversion:

- Range-bound markets — the price has bounced off a band several times in the last 100+ bars
- Low realized volatility relative to the move size you want to capture
- High frequency of wicks back into the previous bar's range (visible on a candlestick chart)

Signs the regime favours momentum (do NOT use mean reversion):

- A fresh all-time high / low within the last 20 bars
- Volatility expansion after a quiet period (BB width widening)
- News-driven repricing (earnings, regulation, macro print)

## Canonical signals

| Trigger | Entry | Exit |
|---|---|---|
| RSI(14) crosses below 30 | Long (small size) | RSI > 50, or trailing stop at 1× ATR |
| Price touches lower Bollinger Band | Long (counter-trend) | Mid-band, or 2× ATR stop |
| Price > VWAP + 2σ intraday | Short | VWAP cross back |

## Position sizing

Mean reversion trades have a higher win rate but smaller winners and fat left tails (the band keeps moving). Use **half the size of a comparable momentum trade** and put the stop *outside* the deviation, not inside it.

A common shape is `notional = cash × 0.25` with a stop 1.5–2× ATR below entry on a long.

## Reference pattern

```typescript
import type { Candle, Strategy } from '@seris/strategy';
import { rsi, sma } from '@seris/strategy';

export const strategy: Strategy = {
  name: 'rsi-reversion',
  timeframe: '1h',
  params: {
    rsiPeriod: { type: 'int', default: 14, min: 5, max: 30 },
    oversold: { type: 'int', default: 30, min: 15, max: 40 },
    overbought: { type: 'int', default: 70, min: 60, max: 85 },
    sizeFraction: { type: 'float', default: 0.25, min: 0.05, max: 0.5 },
  },
  warmup: (p) => Number(p.rsiPeriod) + 5,
  onCandle(candles: Candle[], ctx, p) {
    const period = Number(p.rsiPeriod);
    const oversold = Number(p.oversold);
    const overbought = Number(p.overbought);
    const r = rsi(candles, period);
    if (!Number.isFinite(r)) return { kind: 'hold' };

    if (!ctx.position && r < oversold) {
      const notional = ctx.cash * Number(p.sizeFraction);
      if (notional > 0) {
        return { kind: 'enter-long', notional, reason: `RSI ${r.toFixed(1)} < ${oversold}` };
      }
    }
    if (ctx.position && r > (oversold + overbought) / 2) {
      return { kind: 'exit', reason: `RSI ${r.toFixed(1)} back to midpoint` };
    }
    return { kind: 'hold' };
  },
};
```

## Failure modes worth diagnosing

- **Catching a falling knife** — the band keeps walking lower; you keep buying the dip. Diagnose with the `backtest-diagnose` skill: look for clustered losses near a breakdown.
- **Edge too thin for fees** — most reversion trades target < 1%. At `feeBps=5 + slippageBps=5` per side, the edge is gone. Either widen the target or drop the frequency.
- **The regime changed mid-run** — the first half of the equity curve rises while the second half flat-lines or falls. Compare Sharpe of the first and second half of the run; if they diverge wildly, the strategy is regime-bound.
