---
name: brokerage
description: Read brokerage connector data and preview orders; distinguish live execution from local simulation.
metadata:
  seris:
    priority: 30
    tool_names: [brokerage_accounts_get, brokerage_positions_get, brokerage_order_preview, brokerage_order_submit, brokerage_order_cancel, brokerage_orders_get, brokerage_activities_get]
---
# Brokerage

Start by checking accounts and positions. If a tool returns `mock` or `stub`, clearly identify its data or receipt as simulated. Before submitting an order, show the instrument, side, quantity, order type and price from `brokerage_order_preview` and obtain user confirmation. A preview is not an execution. Report submission or cancellation according to the connector result; never infer a fill from a mock record.
