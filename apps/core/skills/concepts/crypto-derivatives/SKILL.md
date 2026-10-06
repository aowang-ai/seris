---
name: concept-crypto-derivatives
description: Perpetual futures beyond funding — open interest, liquidation cascades, basis term structure, and how to use them as confirmation signals.
metadata:
  seris:
    priority: 26
    tool_names: [get_perp_snapshot, get_perp_funding_history, get_fear_greed]
---

# Crypto derivatives signals

## Beyond funding

Funding rate is the most visible perp metric, but not the only one:

| Metric | What it tells you |
|---|---|
| **Open Interest (OI)** | Total outstanding contracts. Rising OI + rising price = new longs entering. Falling OI + rising price = short covering. |
| **OI-weighted funding** | More informative than raw funding — tells you where the leverage actually sits |
| **Basis term structure** | Perp vs quarterly futures spread. Backwardation = stress; contango = complacency |
| **Liquidation clusters** | Where leveraged positions get wiped. A magnet for price |

## OI as a confirmation signal

The most useful derivative metric for a price-based strategy:

- **Price up + OI up + funding positive** → trend is leveraged and crowded; fade risk rising
- **Price up + OI down + funding negative** → short squeeze; trend may extend
- **Price down + OI up + funding negative** → leveraged shorts crowding; bounce risk rising
- **Price down + OI down + funding positive** → long capitulation; bottom may be near

## What Seris has

- `get_perp_snapshot` — current mark price, funding, OI for a given perp
- `get_perp_funding_history` — historical funding rates

## What Seris cannot do

- **Historical OI series** — we can read current OI but not chart it over time
- **Liquidation heatmap** — no data on where liquidation clusters sit
- **Basis term structure** — we only see perp, not quarterly futures

## Practical use

Use `get_perp_snapshot` as a **confirmation layer** before entering a trade suggested by a price-based strategy:

1. Strategy signals long
2. Check OI + funding: if OI is spiking and funding is > +0.05%, the long is crowded → reduce size or wait
3. Check OI + funding: if OI is flat and funding is neutral, the long has room to run

**No code example in this build.** The engine does not receive OI/funding data in the candle feed.
