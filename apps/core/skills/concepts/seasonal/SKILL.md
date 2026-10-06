---
name: concept-seasonal
description: Calendar-based edges in crypto — day-of-week, weekend effect, monthly turn-of-month, halving cycles. How to test them honestly and when they're worth trading.
metadata:
  seris:
    priority: 27
    tool_names: [strategy_get, strategy_backtest, strategy_backtest_history]
---

# Seasonal patterns

## Why crypto has any seasonal edge at all

Crypto trades 24/7, so it doesn't inherit the classic equity-market calendar effects. But it has its own:

| Pattern | Plausible mechanism |
|---|---|
| **Weekend effect** | Lower institutional participation Sat/Sun; lower liquidity exaggerates retail flow |
| **Turn-of-month** | Fund rebalancing, payroll inflows, options expiry clusters |
| **Funding cycle** | Hyperliquid/Binance funding timestamps concentrate positioning |
| **Halving cycle** | BTC miner supply reduction on a fixed 4-year schedule (2012, 2016, 2020, 2024) |

The weekend effect is the most studied. Historically, weekend returns have been lower-quality (higher variance per unit of volume) than weekday returns, and reversals from Friday close to Monday open have been tradeable in some regimes.

## The honesty checklist

Before trusting any seasonal pattern, ask:

1. **Is the sample size adequate?** A "BTC rises on Fridays" pattern needs at least 100 Fridays in the backtest window. Below that, the t-statistic is meaningless.
2. **Is it regime-dependent?** The 2017 weekend effect may not exist in 2024. Split the backtest and compare sub-periods.
3. **Does it survive transaction costs?** A 0.3% edge traded every week is ~16% annualized — but only if fees + slippage don't eat it.
4. **Is there a structural reason it should persist?** Patterns with a mechanism (payroll, rebalancing) outlive patterns without one (pure statistical artifact).

## Reference implementation

See `skills/strategies/weekend-fade/` — a strategy that goes flat on Friday evening and re-enters Monday morning, betting that weekend chop underperforms holding.

## Failure modes

- **Overfitting the day-of-week.** If you try 7 days × 24 hours × multiple entry/exit rules, you will find something by chance. Use a Bonferroni correction on multiple comparisons.
- **Ignoring the sample window.** A weekend effect measured over 2020–2021 (institutional adoption period) may not exist in 2023–2024.
- **Trading the signal too late.** If the effect is "Friday close → Monday open", entering on Friday morning already misses it. The strategy must enter *before* the weekend starts.
