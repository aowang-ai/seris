---
name: market-extended
description: Read sentiment, derivatives positioning and chain TVL indicators.
metadata:
  seris:
    priority: 12
    tool_names: [get_fear_greed, get_trending_tokens, get_global_market, get_perp_funding_rate, get_perp_open_interest, get_long_short_ratio, get_chain_tvl]
---
# Market indicators

Identify the venue and sampling period for funding, open interest and long/short ratios. State the units before comparing values. Fear/greed and trending lists are indicators rather than trading instructions. Chain TVL describes capital in protocols and should not be treated as trading volume. Report unavailable metrics instead of estimating them silently.
