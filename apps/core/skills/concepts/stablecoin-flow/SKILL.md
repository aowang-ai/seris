---
name: concept-stablecoin-flow
description: Stablecoin supply and flow as a liquidity indicator. USDT/USDC market cap changes as a proxy for fiat inflow/outflow.
metadata:
  seris:
    priority: 25
    tool_names: [get_global_market, get_crypto_news]
---

# Stablecoin flow

## Why stablecoins matter

Stablecoins (USDT, USDC) are the fiat on-ramp for crypto. When their total market cap grows, new money is entering the ecosystem. When it shrinks, money is leaving.

## The signal

| Observation | Interpretation |
|---|---|
| USDT+USDC market cap rising | Fiat inflow; bullish for crypto broadly |
| USDT+USDC market cap falling | Fiat outflow; bearish |
| USDT market cap rising while USDC falls | Geographic shift (USDC is US-centric, USDT is global) |
| Stablecoin dominance rising | Risk-off within crypto; money sitting on sidelines |

## What Seris has

- `get_global_market` — total crypto market cap and volume. Does NOT break out stablecoin market cap separately.
- `get_crypto_news` — may mention stablecoin mint/burn events.

## What Seris cannot do

- **Historical stablecoin supply** — no time series of USDT/USDC market cap
- **Mint/burn tracking** — no on-chain event feed
- **Exchange stablecoin balances** — no data on how much USDT sits on Binance vs. in cold storage

## Practical use

Ask the user to provide the data manually if they want to incorporate it:

> "I can't pull historical stablecoin supply data in this build. If you have a Glassnode or CoinGecko export of USDT+USDC market cap, I can help you analyze it as a custom indicator."

**No code example in this build.**
