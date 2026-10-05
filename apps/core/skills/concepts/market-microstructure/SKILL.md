---
name: concept-market-microstructure
description: How prices actually form — bid-ask spread, slippage, order flow, and why bar-only backtests systematically overestimate strategies. Calibration reference for fee and slippage parameters in Seris backtests.
metadata:
  seris:
    priority: 28
    tool_names: [strategy_backtest_history, strategy_backtest]
---

# Market microstructure — what to set `feeBps` and `slippageBps` to

## Why this matters

A backtest with the wrong fee/slippage assumptions will systematically favour the strategy. The single most common reason "the backtest was green but live was red".

The Seris engine applies `feeBps` (a flat commission on notional, per side) and `slippageBps` (a flat haircut on the fill price, against the trader). Both are pessimistic simplifications of a richer reality.

## Reference values

| Venue | Maker fee | Taker fee | Realistic slippage |
|---|---|---|---|
| Binance spot (retail, no BNB) | 10 bps | 10 bps | 1–3 bps on majors, 5–15 bps on alts |
| Binance USDT-M perp | 2 bps | 5 bps | 1–2 bps on BTC/ETH, 5–10 bps on mid-cap perps |
| Hyperliquid perp | 0 bps | 2.5 bps | 1–3 bps on majors |
| Coinbase Advanced spot | 40 bps | 60 bps | 5–20 bps |
| Kraken spot | 16 bps | 26 bps | 3–10 bps |

These are ballparks. They change with volume tier. **When in doubt, double the taker fee and treat that as the realistic case.**

The engine fills at the next bar's open. Slippage exists because the open you see and the price you actually get differ by:

- The bid-ask spread at that moment (typically the dominant term, 1–5 bps on majors)
- Your own market impact (only matters above $100k on majors, smaller on alts)
- Latency between the signal and your fill (not modelled by the engine)

A default of `slippageBps = 5` is roughly the median for BTC/ETH spot on a good day. On 1h bars during volatility spikes, the real slippage can be 20+ bps. Stress-test by re-running with `slippageBps: 15` to see if the edge survives.

## The bar-fill trap

This engine fills at the next bar's open. That is **the standard Freqtrade convention** and it hides two failure modes:

1. **Stop-loss slippage.** When a stop fires mid-bar (bar's low crosses the stop), the real fill is almost always *worse* than the stop price. We model it with `applySlippage` against the stop, which is correct in spirit. Do not assume this is enough — during a flash crash the slippage is unbounded.
2. **Wick fills.** If the strategy targets a price level touched only by a wick (e.g. a limit order at a swing low), the backtest may fill you at the level even though only a fraction of orders filled there in reality. Our engine uses market orders at the open, so this trap is *not* present, but the price you get is the next open, not the level you wanted.

## Reading order flow is *not* in scope

VPIN, Kyle lambda, Amihud illiquidity, trade signing, and order-book imbalance all require tick data or L2 book snapshots. We have only OHLCV. Do not propose strategies that need them — the engine cannot backtest them honestly.

## Calibration heuristic

When in doubt about fee/slippage, look at the strategy's per-trade edge:

```
edgePerTrade ≈ (totalReturn / tradeCount) × positionSize
```

If `edgePerTrade < 3 × (feeBps + slippageBps)`, the strategy is fragile to execution costs. Double `feeBps` and `slippageBps` and re-run; if the run flips red, the edge is not real.

If the strategy trades more than once per 24h on 1h bars, fee sensitivity dominates every other concern. Either reduce frequency or accept that the strategy only works in low-fee venues.
