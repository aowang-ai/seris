---
name: concept-sector-rotation
description: Rotating between crypto sectors (L1, DeFi, meme, gaming) based on relative strength. Uses CoinGecko category data when available.
metadata:
  seris:
    priority: 26
    tool_names: [get_trending_tokens, get_global_market, get_crypto_news]
---

# Sector rotation

## The idea

Different crypto sectors outperform at different phases of a cycle. A rotation strategy moves exposure toward the strongest sector and away from the weakest.

Classic sector taxonomy:

| Sector | Examples | Typical cycle phase |
|---|---|---|
| L1 / Infrastructure | BTC, ETH, SOL, AVAX | Early bull, risk-on |
| DeFi | UNI, AAVE, MKR, CRV | Mid bull, yield-seeking |
| Meme / Speculative | DOGE, SHIB, PEPE | Late bull, euphoria |
| Gaming / Metaverse | AXS, SAND, MANA | Narrative-driven spikes |

## What Seris can do

- `get_trending_tokens` — see which tokens are being searched (proxy for retail attention)
- `get_global_market` — total market cap, BTC dominance. BTC dominance rising = risk-off; falling = alt season
- `get_crypto_news` — sector-specific headlines

## What Seris cannot do

- **Historical sector indices** — CoinGecko has category data but we don't have a clean API for it
- **Automated rotation** — the engine backtests one instrument at a time; a rotation strategy would need to switch instruments, which is not supported

## Practical approach for the user

Use the chat interface for sector rotation analysis, not the backtest engine:

1. Ask: "What's the current BTC dominance? Is it rising or falling?"
2. Ask: "Which sectors are trending on CoinGecko?"
3. Ask: "Show me the 7-day performance of SOL, AVAX, and ETH"

Then manually pick the strongest sector and backtest a representative token from that sector.

**No code example in this build.**
