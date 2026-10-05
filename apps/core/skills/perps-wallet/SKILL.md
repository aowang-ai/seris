---
name: perps-wallet
description: Inspect simulated perpetual wallet records and dry-run transfer receipts.
metadata:
  seris:
    priority: 20
    tool_names: [seris_perps_wallets_list, seris_perps_wallet_summary, seris_perps_wallet_fills, seris_wallet_fund_perp, seris_wallet_withdraw_to_spot]
---
# Perpetual wallet prototype

The wallet tools currently use local mock balances and fills. Transfers are simulated and do not sign or broadcast transactions. State these limits when reporting a balance, PnL or receipt; never describe a simulated transfer as funds moved. For real public position data, use the Hyperliquid position tool with the address supplied by the user.
