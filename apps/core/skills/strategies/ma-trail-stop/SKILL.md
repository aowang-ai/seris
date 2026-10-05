---
name: ma-trail-stop
description: Dual moving-average crossover with explicit ATR trailing stop. Enters long when fast SMA crosses above slow SMA, ratchets stop up using trailing ATR below the post-entry peak, and exits on stop hit or death cross.
metadata:
  seris:
    priority: 50
    tool_names: [strategy_backtest, strategy_backtest_history]
---

# MA crossover with trailing stop

This strategy is the canonical example of the Seris strategy contract:

- **Timeframe:** 1h crypto candles (Binance spot or Hyperliquid perps)
- **Entry:** fast SMA crosses above slow SMA. Size is `sizeFraction × cash`.
- **Initial stop:** `atrMultiple` × ATR(atrPeriod) below the entry bar's close
- **Trailing stop:** once in, ratchets up to `trailAtrMultiple` × ATR below the highest close since entry. Stop never moves down.
- **Exit:** engine fills at stop when the bar's low touches it; strategy also exits on fast-below-slow cross.

## What this strategy demonstrates

- Pure `Strategy` object with `params`, `warmup`, `onCandle`
- All five signal kinds in use: `enter-long`, `exit`, `adjust-stop`, implicit `hold`
- Params that affect warmup (`slow`, `atrPeriod`)
- Pure indicator helpers and types imported from `@seris/strategy`

## Creating a variant

Import `Strategy`, `Candle` and indicator helpers from `@seris/strategy`.
Use `strategy_save_draft` with a new name and review the source in its approval
card. Drafts are saved in persistent app data, separately from this bundled example.

## Tuning hints

- Wide `slow` (50+) behaves like a trend follower; tight `slow` (<20) is closer to a momentum scalper
- `atrMultiple` is the *initial* risk; `trailAtrMultiple` is the *give-back* on runners. Often you want trail < initial.
- `sizeFraction` linearly scales returns but does NOT change Sharpe; pair with slippage/fee parameters in `strategy_backtest` for realistic figures.
