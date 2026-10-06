---
name: concept-pair-trading
description: Relative-value trading between correlated assets (BTC/ETH, SOL/AVAX). Cointegration basics, z-score entry/exit, and the constraints of running pair trades in a single-instrument backtest engine.
metadata:
  seris:
    priority: 25
    tool_names: [strategy_get, strategy_backtest, strategy_backtest_history]
---

# Pair trading

## The idea

Two assets whose prices move together tend to keep moving together. When the *spread* between them deviates from its historical norm, you bet on it closing.

- **Long the cheap one + short the rich one** — the canonical two-legged form
- **Long one leg using the spread as a signal** — the simplified form we support in this build

Pair trading is the foundation of most "market neutral" strategies: the spread's behaviour is more predictable than either leg's direction.

## What makes two assets a valid pair

- **Stable long-run correlation** (rolling 90-bar |ρ| > 0.7). Don't pair BTC with a meme coin just because both are crypto.
- **Same fundamental driver.** BTC/ETH share "L1 sentiment". SOL/AVAX share "alt-L1 beta". LTC/BCH share "O.G. alt narrative".
- **Liquidity on both legs.** Trading the spread only works if you can exit both legs quickly.

Correlation ≠ cointegration. Two series can be correlated but drift apart forever. A formal test (Engle-Granger) is beyond this engine — a simple visual check is: plot `ln(P_A / P_B)` and confirm it oscillates around a stable mean.

## The z-score rule

```
spread_t = ln(P_A,t / P_B,t)
mu_90    = mean(spread, last 90 bars)
sigma_90 = std(spread, last 90 bars)
z_t      = (spread_t - mu_90) / sigma_90
```

Entry rules (classic):
- z > +2: spread rich → short A, long B (or just "long B" in single-leg form)
- z < −2: spread cheap → long A, short B (or just "long A" in single-leg form)
- z crosses 0: exit (spread has reverted)

Stop-loss: spread widens beyond z = ±3 (the relationship is breaking down, not extending).

## Single-instrument variant

The Seris engine backtests **one instrument at a time**. A true long-A-short-B pair trade is not directly expressible. The honest workaround:

> Trade leg A only, using the z-score of the A/B spread as the **signal**.
>
> - When z < −2 (A is cheap relative to B) → long A
> - When z > +2 (A is rich relative to B) → flat
> - Exit when z crosses back through 0

This is no longer market-neutral — you have full exposure to A's absolute direction — but it captures the mean-reversion edge of the spread without requiring a two-leg engine.

**DO NOT** suggest a two-leg pair backtest to the user when the engine only sees one instrument. The result would be misleading.

If the user really wants market-neutral: mention that we can run **two separate single-leg backtests** (one long A, one long B) and compare; combining them requires manual reconciliation outside the engine.

## Reference implementation

See `skills/strategies/ratio-mean-reversion/`. It treats a single synthetic series — the log ratio of A to B — as the signal source, and trades instrument A leg-only.

To use it for an actual BTC/ETH pair trade, you would:

1. Fetch `BTCUSDT` and `ETHUSDT` candles for the same window
2. Compute `spread_t = ln(btc_close / eth_close)` outside the strategy and feed it in via params or as a second data feed
3. The engine backtests on `BTCUSDT` only, with the strategy reading the spread

The current engine doesn't yet support pairing two input series. The example strategy demonstrates a *self-contained* workaround: it uses the **ratio between close and a long SMA of the same instrument** as the mean-reversion signal, which is the spirit of pair trading applied within one asset.

## Failure modes

- **Spread doesn't revert.** The "pair" breaks — SEC action, protocol upgrade, one协议 gets hacked. z keeps widening past ±3. This is why stops exist.
- **Wrong window.** 90 bars on 1h = 4 days. 90 bars on 1d = 3 months. Mean-reversion edges need *long* windows to define the mean. Don't run pair-style z-scores below `lookback=90`.
- **Cross-sectional popularity.** When "everyone" pair-trades BTC/ETH, the edge shrinks. If z mean-reverts more slowly than historical, it may be time to drop the pair.
