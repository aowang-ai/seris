---
name: concept-onchain-analysis
description: On-chain valuation metrics (MVRV, NVT, SOPR) and whale tracking. What Seris can and cannot do with on-chain data in this build.
metadata:
  seris:
    priority: 28
    tool_names: [get_transaction_status]
---

# On-chain analysis

## What this is

On-chain analysis reads the blockchain itself — not just price — to infer valuation, positioning, and network health. The core metrics:

| Metric | What it measures |
|---|---|
| **MVRV** | Market Value / Realized Value. >1 means holders are in profit; extreme values signal tops/bottoms |
| **NVT** | Network Value / Transaction Volume. High NVT = price rich relative to usage |
| **SOPR** | Spent Output Profit Ratio. >1 means sellers are profitable; <1 means capitulation |
| **Active addresses** | Daily unique addresses sending/receiving. Proxy for adoption |
| **Whale tracking** | Large wallet movements to/from exchanges. Inflow = sell pressure |

## What Seris can do today

- `get_transaction_status` — look up a specific BTC or ETH transaction by hash. Useful for confirming a specific transfer, not for aggregate metrics.
- Crypto news via `get_crypto_news` — sometimes mentions whale movements or on-chain events.

## What Seris cannot do today

- **Historical MVRV / NVT / SOPR series** — these require specialized data providers (Glassnode, CryptoQuant, Messari). We do not have these APIs.
- **Whale wallet tracking** — no address-labeling or clustering data.
- **Exchange flow data** — no "coins moved to Binance" aggregate.

**Do not promise the user an on-chain backtest.** The engine does not have the data. If the user asks, be honest: "I can look up a specific transaction, but I cannot backtest MVRV-based strategies in this build."

## When the user has external data

If the user provides a CSV of MVRV values (e.g. exported from Glassnode), the strategy can read it as an external series. But the engine's `onCandle` signature only receives OHLCV candles — external data would need to be merged into the candle array before the backtest starts.

**No code example in this build.**
