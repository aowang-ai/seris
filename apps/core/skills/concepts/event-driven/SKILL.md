---
name: concept-event-driven
description: Trading around scheduled events — token unlocks, halvings, regulatory deadlines, earnings. How to structure event-driven strategies when the engine has no event calendar.
metadata:
  seris:
    priority: 25
    tool_names: [strategy_get, strategy_backtest_history, get_crypto_news]
---

# Event-driven trading

## The idea

Markets price in known events before they happen. The edge comes from:

- **Positioning** — being early to a widely anticipated event
- **Reaction** — trading the over- or under-reaction after the event
- **Volatility** — selling options premium before the event (not supported here)

## Common crypto events

| Event type | Example | Typical pattern |
|---|---|---|
| Token unlock | Vesting schedule releases | Price often drops in the week before unlock |
| Halving | BTC every 4 years | Long-term bullish; short-term sell-the-news |
| Regulatory deadline | ETF approval/rejection | Binary; high volatility |
| Hard fork / upgrade | Ethereum merge | Pre-event rally, post-event fade |
| Earnings (for crypto-adjacent equities) | Coinbase, MicroStrategy | Correlated with crypto beta |

## What Seris cannot do

- **No event calendar** — the engine does not know when unlocks, halvings, or earnings occur
- **No event feed** — no way to inject "BTC halving is in 30 days" into the strategy at runtime

## The workaround

Ask the user to specify the event date, then hardcode it into the strategy:

```typescript
// User says: "BTC halving is on 2028-04-15"
const HALVING_MS = Date.UTC(2028, 3, 15); // month is 0-indexed

onCandle(candles, ctx, p) {
  const bar = candles[candles.length - 1];
  const daysToHalving = (HALVING_MS - bar.time) / 86_400_000;

  if (!ctx.position && daysToHalving > 0 && daysToHalving < 30) {
    // Enter 30 days before halving
    return { kind: 'enter-long', notional: ctx.cash * 0.5, reason: 'Pre-halving accumulation' };
  }
  if (ctx.position && daysToHalving < -7) {
    // Exit 7 days after halving
    return { kind: 'exit', reason: 'Post-halving fade' };
  }
  return { kind: 'hold' };
}
```

This is crude but honest. The strategy explicitly encodes the user's event knowledge.

## Failure modes

- **The event is already priced in** — if everyone knows the halving date, the pre-event rally may start 6 months early, not 30 days
- **The event is delayed or cancelled** — regulatory deadlines slip; the strategy has no way to know
- **Binary outcomes** — ETF approval is 0/1; a strategy that goes long "expecting approval" loses 100% if rejected

**No code example in this build.** Event-driven strategies are too idiosyncratic to template.
