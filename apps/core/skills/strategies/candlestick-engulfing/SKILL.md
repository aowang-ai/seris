---
name: candlestick-engulfing
description: Bullish engulfing pattern after a downtrend, with a stop below the pattern low and a fixed reward:risk take-profit. Demonstrates multi-candle pattern detection and simultaneous stop + TP signalling.
metadata:
  seris:
    priority: 51
    tool_names: [strategy_backtest, strategy_backtest_history]
---

# Bullish engulfing with fixed R:R

The companion example for the `concept-candlestick` skill. Runnable; loads under the strategy engine.

## Behaviour

- **Context filter:** close must be below SMA(`trendPeriod`) — establishes a downtrend
- **Pattern trigger:** current bar bullish-engulfs the previous bar with body ≥ `minBodyPct` of range
- **Stop:** `min(prev.low, cur.low)`
- **Take-profit:** entry + (entry − stop) × `rewardRisk`
- **Exit:** engine fills at whichever the bar touches first (stop wins if both touch in the same bar)

## Tuning

- Bump `minBodyPct` from 0.55 to 0.7 to be stricter — fewer, higher-quality patterns
- The `rewardRisk` knob controls the win-rate / profit-factor tradeoff: lower values raise win rate but reduce edge per win
- On higher timeframes (4h, 1d) the pattern is more reliable but trades are rarer; on 15m it fires often but fees dominate
