---
name: weekend-fade
description: Flat over weekends, long only on weekdays. Pure calendar strategy — no price signal. Tests the hypothesis that weekend chop underperforms weekday moves.
metadata:
  seris:
    priority: 53
    tool_names: [strategy_backtest, strategy_backtest_history]
---

# Weekend fade

The simplest possible seasonal strategy: be long only on weekdays, flat on weekends.

## Why this exists

Weekend crypto price action is thinner (less institutional flow, wider spreads, more retail noise). Historically, some regimes have shown weekend returns to be lower-quality than weekday returns. This strategy tests that directly by simply not being exposed on weekends.

## Behaviour

- **Friday evening (UTC):** exit any open position
- **Monday morning (UTC):** re-enter with `sizeFraction` of cash
- **Safety:** also exits if somehow holding through Saturday/Sunday

## What to look for in the backtest

- **Total return vs. buy-and-hold.** If holding through weekends is bad, this strategy should outperform.
- **Trade count.** Should be roughly `4 × number of weeks` (exit Friday, enter Monday, ~2 round trips per week).
- **Fee drag.** With 2 round trips per week at 5 bps taker + 5 bps slippage per side, costs are ~40 bps/year. Small but non-trivial.

## Honest caveat

The weekend effect is regime-dependent. A backtest over 2020–2021 may show a strong edge; 2023–2024 may show none. Split the date range and compare sub-periods before concluding.
