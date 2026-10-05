---
name: market-data
description: Fetch crypto quotes and historical prices from CoinGecko and Binance.
metadata:
  seris:
    priority: 10
    tool_names: [get_token_price, search_tokens, get_market_chart, get_funding_rate, get_klines]
---
# Crypto prices

Resolve ambiguous names with `search_tokens`. Use `get_token_price` for a quote, `get_market_chart` for historical price samples and `get_klines` for Binance spot candles. Preserve source, units and timestamps. `get_funding_rate` may return a placeholder; use the real perpetual funding tools when needed. Price read tools do not change the visible chart. For a chart view action, load the Markets skill and use `market_set_view`.
