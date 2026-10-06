---
name: concept-candlestick
description: Classic candlestick pattern recognition — hammer, engulfing, morning/evening star, doji. When single-bar and multi-bar patterns carry signal, and when they don't. Includes a TS reference implementation.
metadata:
  seris:
    priority: 25
    tool_names: [strategy_get, strategy_backtest, strategy_backtest_history]
---

# Candlestick patterns

## What a pattern actually tells you

A candlestick pattern is a *lossy summary* of one or a few bars. It carries signal only in three situations:

1. **At a significant level** (prior swing high/low, moving average, prior close). The same engulfing pattern at a random location has near-zero edge.
2. **On a timeframe where the bar contains real information** (1h+, ideally 4h+). Below 15m most patterns are noise.
3. **After a clear directional move** (a downtrend into a hammer). Patterns in sideways chop have no trend to reverse.

Do NOT use a candlestick pattern alone as an entry trigger. Use it as a **confirmation** layered on top of a level or a trend filter.

## The five patterns worth knowing

### Hammer (single bar, bullish reversal)

```
   ┃   ← small body near top
   ┃
   ┃
   ┃   ← lower shadow ≥ 2× body, upper shadow ≤ 0.5× body
```

Rules:
- Body in the top third of the bar's range
- Lower shadow ≥ 2× body length
- Upper shadow ≤ 0.5× body length
- Prior 3+ bars in a downtrend

Inverted hammer is the mirror. **Shooting star** is the same shape at a swing high (bearish), **hanging man** is the same shape at a swing high after an uptrend (bearish). Same shape, opposite implication.

### Bullish engulfing (two bars, bullish reversal)

Bar 2's body completely covers bar 1's body. Bar 1 is red, bar 2 is green. The larger bar 2's body relative to bar 1, the stronger the signal.

### Morning star (three bars, bullish reversal)

Bar 1: strong red. Bar 2: small body (doji-ish), gaps down. Bar 3: strong green, closes above bar 1's midpoint.

### Doji (single bar, indecision)

Body ≤ 10% of the bar's range. **A doji alone is not a signal** — it tells you neither buyers nor sellers won. What matters is what happens on the *next* bar.

### Three white soldiers / three black crows (three bars, continuation)

Three consecutive same-color bars with each close in the top/bottom third of its range. Continuation signal, not reversal.

## Reference implementation

See `skills/strategies/candlestick-engulfing/` — a runnable strategy that requires:

1. A prior down move (close below SMA 20)
2. A bullish engulfing pattern on the current bar
3. A stop below the engulfing bar's low
4. A 2:1 reward-to-risk take-profit

The pattern detection helpers (body, range, shadows, isEngulfing) are worth lifting into your own strategies.

## Failure modes

- **Treating the shape as a signal without context.** A hammer in the middle of a range means nothing. Combine with a level or trend filter.
- **1m and 5m timeframes.** Below 15m the patterns fire constantly and fees eat everything.
- **Ignoring volume.** A hammer on low volume is less reliable than one on a volume spike.
