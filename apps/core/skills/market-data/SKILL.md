---
name: market-data
description: Fetch crypto quotes and historical prices from CoinGecko and Binance.
metadata:
  seris:
    priority: 10
    tool_names: [get_token_price, search_tokens, get_market_chart, get_klines, get_perp_snapshot, get_perp_funding_history, get_perp_funding_rate]
---
# Crypto prices

Resolve ambiguous names with `search_tokens`. Use `get_token_price` for a quote, `get_market_chart` for historical price samples and `get_klines` for Binance spot candles. Preserve source, units and timestamps. Use `get_perp_snapshot` and `get_perp_funding_history` for Hyperliquid funding, or `get_perp_funding_rate` for Binance funding history. Report unavailable data explicitly. Price read tools do not change the visible chart. For a chart view action, load the Markets skill and use `market_set_view`.
