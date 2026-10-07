---
name: concept-funding-basis
description: Read funding rates and spot-perp basis as positioning signals. Useful for crypto strategies that fade extreme leverage, time carry entries, or detect forced liquidations.
metadata:
  seris:
    priority: 22
    tool_names: [strategy_get, strategy_backtest, get_perp_snapshot, get_perp_funding_history, get_perp_funding_rate]
---

# Funding rates & basis

## Where the signal comes from

Perpetual futures never expire. Exchanges anchor their price to spot via funding payments. Use the actual venue and instrument settlement interval; do not assume all sources use an eight-hour cycle:

- **funding > 0** — longs pay shorts. Perp is rich to spot, indicating leveraged long crowding.
- **funding < 0** — shorts pay longs. Perp is cheap, indicating leveraged short crowding.
- **basis = perp price − spot price** — the raw price gap. Funding is the mechanism that closes it.

## Reading extremes

Funding is a **relative** indicator. Compare against its own history, not a fixed threshold.

| Regime | Funding (8h) | What it usually means |
|---|---|---|
| Calm | −0.005% .. +0.01% | Balanced positioning; carry is cheap |
| Heated | +0.02% .. +0.05% | Leverage crowded long; squeeze risk *against* longs |
| Euphoric | > +0.05% sustained | Late-stage long overcrowding; often precedes a flush |
| Depressed | < −0.02% sustained | Shorts crowded; often precedes a short squeeze |

The crowd being "right" for a while does NOT mean the trade is safe — at extremes, *the crowd itself becomes the catalyst for the unwind*.

## Two usable signals

**1. Fade-the-extreme (contrarian).**
When funding crosses a rolling 90th percentile (either side) AND a momentum indicator agrees (e.g. fast MA rolls over), enter the opposite direction for a short hold (4h–24h). High turnover strategy; only works on liquid perps.

**2. Carry trade (cash-and-carry).**
When funding is high and *stable positive*, a short perp vs. long spot position collects funding. A simple annualized estimate is `funding_rate_per_settlement × settlements_per_day × 365`; identify the interval and units before calculating it. This trade has basis risk (the gap can widen before funding converges), liquidation risk on the short leg, and counterparty risk on the perp venue. NOT suitable for a single-leg backtest in this engine — the engine trades one instrument at a time.

## What to feed into a Seris backtest

Our current engine replays OHLCV candles and does not see funding data directly. To use funding in a strategy:

- Fetch funding via the real venue tools in a **separate tool call** and pass the relevant percentile into the strategy as a param override
- Write the strategy to use a `fundingExtremeBps` param — the threshold above/below which the trigger activates
- Do NOT hardcode funding thresholds — what counts as "extreme" varies by asset and regime

## Common failure modes

- **Funding reverts before price does** — funding is a leading indicator of *crowding*, not of *price direction*. Do not fade purely on funding; require price confirmation.
- **Ignoring the funding decay rate** — extreme funding can persist for days in bull runs. A contrarian entry without a stop is a liquidation magnet.
- **Assuming 8h cycle** — some venues fund hourly or continuous. Check the venue before writing a "fade one bar after funding" rule.
