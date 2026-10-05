---
name: data-sources
description: Look up stock quotes, DEX liquidity, crypto news and Bitcoin or Ethereum transaction details.
metadata:
  seris:
    priority: 14
    tool_names: [get_stock_snapshot, get_dex_token_snapshot, search_dex_tokens, lookup_token, search_listed_tokens, get_crypto_news, get_transaction_status]
---
# Data lookup

Use the lookup tools to resolve symbols and chain addresses before interpreting a quote. DEX pair data describes that pair's liquidity and trading activity, not all markets for the token. Date news and identify its source. For transaction queries, report the network, confirmation state, sender, recipient and fee returned by the tool. Missing data is not a zero balance or a failed transaction.
