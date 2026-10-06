---
name: ratio-mean-reversion
description: Z-score mean reversion on the price/long-SMA ratio. Enters long when the log ratio is statistically cheap, exits when it reverts. Companion to `concept-pair-trading`.
metadata:
  seris:
    priority: 52
    tool_names: [strategy_backtest, strategy_backtest_history]
---

# Ratio mean reversion

The single-instrument adaptation of the classic pair-trading rule. Instead of "A is cheap vs B", it trades "price is cheap vs its own trailing mean".

## Why this exists

The Seris engine backtests one instrument at a time. A true pair trade (long A + short B) requires two legs. This strategy captures the *spirit* — z-score mean reversion on a ratio — using only one series.

For a true pair-trade prompt, point the user to `concept-pair-trading` first so they understand the engine constraint before asking for an impossible two-leg backtest.

## Knobs

- `lookback` (default 60 bars) — both the SMA window and the z-score std window. Longer = smoother, slower signals.
- `zEntry` (default −2) — how depressed the ratio must be before entry. −2.5 tightens, −1.5 loosens.
- `zExit` (default 0) — recovery target. Setting to −0.5 exits early (gives back less), to +0.5 holds for the overshoot.
- `hardStopPct` (default 8%) — crash protection. Mean-reversion strategies have fat left tails; do not run unprotected.
