---
name: backtest-diagnose
description: Diagnose a failed or underperforming backtest. Walks the runner, the strategy, and the data in order so the agent can pinpoint the root cause and propose the right fix.
metadata:
  seris:
    priority: 40
    tool_names: [strategy_get, strategy_backtest_history, strategy_backtest_get]
---

# Backtest diagnosis

When a user says "the backtest failed" or "this strategy is losing money", DO NOT guess. Work through this checklist in order. Stop at the first failure point.

## 1. Did the backtest even start?

Most failures happen before the first trade. Common root causes:

- **Strategy did not load.** Run `strategy_get {name}`. If `valid: false`, the `problems` array is the actual error. Fix the strategy file before trying again.
- **Params didn't validate.** `strategy_backtest` rejects unknown override keys. Check that the user's param object only contains keys declared in the strategy's `params` block.
- **Candle fetch returned too few bars.** Below 50 bars the runner throws. Below `warmup + 5` bars the strategy sees no signals. Suggest a longer `days` value.

## 2. Did the backtest complete but produce zero trades?

This is almost always one of:

- **`warmup()` too long.** The strategy never reaches `onCandle` (the internal counter skips it until `warmup` bars have passed). Check that `warmup()` returns the *actual* minimum the indicators need, not a safe upper bound.
- **Signal conditions unreachable.** If the strategy uses an indicator cross (e.g. SMA(9) > SMA(21)) the prices must actually cross in the chosen timeframe and range. Reduce `slow` or lengthen `days`, then re-run.
- **Min-size or cash gate.** Entries with `notional: 0` are silently dropped. Check `cash` is positive and `sizeFraction` > 0.

## 3. Trades exist but the strategy loses money

In order of likelihood for a newly-authored strategy:

- **Slippage / fees eating the edge.** At 1h timeframe with default `feeBps=5` and `slippageBps=5`, a strategy that captures less than ~10 bps per round trip is guaranteed negative. Re-run with `feeBps: 0, slippageBps: 0` to see whether the underlying signal has any edge at all.
- **Stop-loss is fighting the trail.** If many `via: 'stop'` fills appear immediately after entry, the initial stop is too tight. Compare average winner to average loser; if losers cluster just above breakeven the trail is too aggressive.
- **Look-ahead contamination.** Suspect if the equity curve rises monotonically almost every bar. The engine already avoids the most common look-ahead (signal on close, fill on next open), but a strategy that uses a future-looking helper (e.g. `candles[candles.length - 1]` to mean "tomorrow") will silently produce an unrealistic edge. Read `strategy_get.source` for any `+ 1`, `[i + N]`, or look-ahead loops.

## 4. How to read the numbers before concluding

- `tradeCount < 10` — too few trades to conclude anything. Widen the date range.
- `maxDrawdown > 0.3` while `totalReturn > 0` — gains from a few runs, not a stable edge. Check the equity curve shape, not the headline.
- `avgLoss >> avgWin` and `winRate > 0.5` — classic stop-loss scalper that under-earns. Look at trail ATR multiples.

## 5. Then propose ONE change at a time

Do not bundle changes. Run the next backtest with exactly one delta from the run that failed, so the user can attribute the difference. Common single-knob moves:

- Re-run with `feeBps: 0` to isolate price signal
- Increase `days` while keeping params fixed
- Adjust one trail/stop param by 30% in one direction

## Reminder about metricsHash and dataRange

Every saved run carries `metricsHash` and `dataRange {from, to}`. When citing a metric in an answer or report, name the run id and hash (e.g. "run rb_xxx/hash 4c1e… produced Sharpe 1.21 over 2025-07-01..2025-10-01"). Without this attribution the figure is unverifiable by the user.
