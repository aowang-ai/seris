/**
 * Brokerage connector adapter with an explicitly marked local mock
 * fallback. Order tools must report whether a live connector executed them.
 */

import { defineTool, fetchJson, type HarnessTool } from "./registry.js";

/* ------------------------------------------------------------------ */
/* MCP connector bridge                                                */
/* ------------------------------------------------------------------ */

/**
 * A brokerage connector is any process exposing the account's fixed MCP
 * HTTP bridge at env BROKERAGE_MCP_URL (e.g. http://127.0.0.1:8787/mcp).
 * When unset we fall back to the deterministic mock below.
 *
 * Contract (JSON-RPCish, mirrors the empirical connector surface):
 *   POST <base>/<method>  with body = params
 *   -> 200 + JSON result on success; any failure degrades to mock.
 */
const CONNECTOR_BASE = process.env.BROKERAGE_MCP_URL?.replace(/\/+$/, "") ?? null;

async function connectorCall(
  method: string,
  params: Record<string, unknown>,
): Promise<{ live: boolean; data: unknown; note?: string }> {
  if (!CONNECTOR_BASE) {
    return { live: false, data: null, note: "BROKERAGE_MCP_URL not set — mock" };
  }
  const r = await fetchJson(`${CONNECTOR_BASE}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    timeoutMs: 5000,
  });
  if (!r.ok) {
    return {
      live: false,
      data: null,
      note: `connector unreachable (${JSON.stringify(r.error)}) — mock`,
    };
  }
  return { live: true, data: r.data };
}

/* ------------------------------------------------------------------ */
/* Deterministic mock brokerage                                        */
/* ------------------------------------------------------------------ */

interface MockAccount {
  accountId: string;
  label: string;
  broker: "alpaca" | "ibkr";
  currency: string;
  cash: number;
  buyingPower: number;
  equity: number;
}

interface MockPosition {
  accountId: string;
  symbol: string;
  qty: number;
  avgCost: number;
  lastPrice: number;
}

interface MockOrder {
  orderId: string;
  accountId: string;
  symbol: string;
  assetClass: "stock" | "etf";
  side: "buy" | "sell";
  type: "market" | "limit";
  qty: number;
  limitPrice?: number;
  status: "filled" | "open" | "canceled" | "rejected" | "pending";
  submittedAt: number;
  filledAt?: number;
  filledPrice?: number;
}

const MOCK_ACCOUNT: MockAccount = {
  accountId: "brk_mock_4c9d21",
  label: "Primary Brokerage (mock)",
  broker: "alpaca",
  currency: "USD",
  cash: 48_720.15,
  buyingPower: 97_440.3,
  equity: 163_952.77,
};

/** Reference prices so positions/orders/previews agree with each other. */
const MOCK_PRICES: Record<string, number> = {
  AAPL: 238.12,
  MSFT: 512.63,
  NVDA: 187.44,
  TSLA: 251.8,
  SPY: 663.09,
  QQQ: 587.25,
  VOO: 612.4,
};

function mockPrice(symbol: string): number {
  return MOCK_PRICES[symbol.toUpperCase()] ?? 100;
}

const MOCK_POSITIONS: MockPosition[] = [
  { accountId: MOCK_ACCOUNT.accountId, symbol: "AAPL", qty: 60, avgCost: 219.34, lastPrice: mockPrice("AAPL") },
  { accountId: MOCK_ACCOUNT.accountId, symbol: "NVDA", qty: 120, avgCost: 171.02, lastPrice: mockPrice("NVDA") },
  { accountId: MOCK_ACCOUNT.accountId, symbol: "SPY", qty: 40, avgCost: 598.11, lastPrice: mockPrice("SPY") },
];

/** Session-local order book: seeded orders + anything submitted this run. */
const MOCK_ORDERS: MockOrder[] = [
  {
    orderId: "ord_mock_aapl_10",
    accountId: MOCK_ACCOUNT.accountId,
    symbol: "AAPL",
    assetClass: "stock",
    side: "buy",
    type: "market",
    qty: 10,
    status: "filled",
    submittedAt: Date.now() - 1000 * 60 * 60 * 49,
    filledAt: Date.now() - 1000 * 60 * 60 * 49 + 3500,
    filledPrice: 232.41,
  },
  {
    orderId: "ord_mock_spy_5",
    accountId: MOCK_ACCOUNT.accountId,
    symbol: "SPY",
    assetClass: "etf",
    side: "buy",
    type: "limit",
    qty: 5,
    limitPrice: 650.0,
    status: "open",
    submittedAt: Date.now() - 1000 * 60 * 30,
  },
];

function makeOrderId(symbol: string): string {
  return `ord_mock_${symbol.toLowerCase()}_${Math.random().toString(36).slice(2, 8)}`;
}

function requireString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function clampInt(v: unknown, dflt: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : dflt;
  return Math.min(Math.max(n, min), max);
}

/* ------------------------------------------------------------------ */
/* brokerage-accounts skill: read chain                                */
/* ------------------------------------------------------------------ */

export const brokerageAccountsGetTool: HarnessTool = defineTool({
  name: "brokerage_accounts_get",
  description:
    "Get the connected brokerage account(s): account id, broker, currency, cash, buying power, equity. Uses the account's fixed MCP Connector when configured (BROKERAGE_MCP_URL); otherwise a clearly-marked mock.",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      accountId: { type: "string", description: "Optional; omit for the default account." },
    },
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const accountId = requireString(args.accountId) || undefined;
    const r = await connectorCall("accounts_get", { accountId });
    if (r.live) return r.data as Record<string, unknown>;
    const acct = MOCK_ACCOUNT;
    return {
      mock: true,
      note: r.note,
      accounts: [
        {
          accountId: acct.accountId,
          label: acct.label,
          broker: acct.broker,
          currency: acct.currency,
          cash: acct.cash,
          buyingPower: acct.buyingPower,
          equity: acct.equity,
          dayTradingBuyingPower: acct.buyingPower,
          status: "ACTIVE",
        },
      ],
    };
  },
});

export const brokeragePositionsGetTool: HarnessTool = defineTool({
  name: "brokerage_positions_get",
  description:
    "Get open positions for a connected brokerage account: symbol, quantity, average cost, last price, market value, unrealized PnL. Connector-backed when available, mock otherwise.",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      accountId: { type: "string", description: "Optional; omit for the default account." },
      symbol: { type: "string", description: "Optional ticker filter, e.g. \"AAPL\"." },
    },
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const accountId = requireString(args.accountId) || undefined;
    const symbol = requireString(args.symbol).toUpperCase() || undefined;
    const r = await connectorCall("positions_get", { accountId, symbol });
    if (r.live) return r.data as Record<string, unknown>;
    let rows = MOCK_POSITIONS;
    if (symbol) rows = rows.filter((p) => p.symbol === symbol);
    return {
      mock: true,
      note: r.note,
      positions: rows.map((p) => {
        const marketValue = p.qty * p.lastPrice;
        const costBasis = p.qty * p.avgCost;
        return {
          accountId: p.accountId,
          symbol: p.symbol,
          qty: p.qty,
          avgCost: p.avgCost,
          lastPrice: p.lastPrice,
          marketValue: Math.round(marketValue * 100) / 100,
          unrealizedPnl: Math.round((marketValue - costBasis) * 100) / 100,
          unrealizedPnlPct:
            Math.round(((p.lastPrice - p.avgCost) / p.avgCost) * 10000) / 100,
          side: p.qty >= 0 ? "long" : "short",
        };
      }),
    };
  },
});

export const brokerageOrdersGetTool: HarnessTool = defineTool({
  name: "brokerage_orders_get",
  description:
    "List orders on a connected brokerage account: id, symbol, side, type, qty, status, times, fill price. Filter by status (open/filled/canceled/all) and symbol. Newest first.",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      accountId: { type: "string", description: "Optional; omit for the default account." },
      status: {
        type: "string",
        enum: ["open", "filled", "canceled", "rejected", "all"],
        default: "all",
      },
      symbol: { type: "string", description: "Optional ticker filter." },
      limit: { type: "number", default: 50, minimum: 1, maximum: 200 },
    },
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const accountId = requireString(args.accountId) || undefined;
    const status = (requireString(args.status) || "all").toLowerCase();
    const symbol = requireString(args.symbol).toUpperCase() || undefined;
    const limit = clampInt(args.limit, 50, 1, 200);
    const r = await connectorCall("orders_get", { accountId, status, symbol, limit });
    if (r.live) return r.data as Record<string, unknown>;
    let rows = [...MOCK_ORDERS].sort((a, b) => b.submittedAt - a.submittedAt);
    if (status !== "all") rows = rows.filter((o) => o.status === status);
    if (symbol) rows = rows.filter((o) => o.symbol === symbol);
    return {
      mock: true,
      note: r.note,
      returned: Math.min(limit, rows.length),
      orders: rows.slice(0, limit),
    };
  },
});

export const brokerageActivitiesGetTool: HarnessTool = defineTool({
  name: "brokerage_activities_get",
  description:
    "Get brokerage account activities (fills, dividends, transfers) for a connected account. Newest first. Connector-backed when available, mock otherwise.",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      accountId: { type: "string", description: "Optional; omit for the default account." },
      limit: { type: "number", default: 50, minimum: 1, maximum: 200 },
    },
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const accountId = requireString(args.accountId) || undefined;
    const limit = clampInt(args.limit, 50, 1, 200);
    const r = await connectorCall("activities_get", { accountId, limit });
    if (r.live) return r.data as Record<string, unknown>;
    const t0 = Date.now();
    const fills = MOCK_ORDERS.filter((o) => o.status === "filled").map((o) => ({
      activityId: `${o.orderId}_fill`,
      type: "FILL",
      ts: o.filledAt ?? o.submittedAt,
      summary: `${o.side.toUpperCase()} ${o.qty} ${o.symbol} filled @ ${o.filledPrice}`,
      orderId: o.orderId,
      symbol: o.symbol,
      qty: o.qty,
      price: o.filledPrice,
      netAmount: Math.round((o.qty * (o.filledPrice ?? 0) * (o.side === "buy" ? -1 : 1)) * 100) / 100,
    }));
    const misc = [
      {
        activityId: "act_mock_div_1",
        type: "DIV",
        ts: t0 - 1000 * 60 * 60 * 24 * 6,
        summary: "Dividend: SPY $0.00/share x 40",
        symbol: "SPY",
        netAmount: 66.4,
      },
      {
        activityId: "act_mock_csd_1",
        type: "CSD",
        ts: t0 - 1000 * 60 * 60 * 24 * 21,
        summary: "Cash deposit (ACH)",
        netAmount: 25_000,
      },
    ];
    const activities = [...fills, ...misc]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);
    return { mock: true, note: r.note, returned: activities.length, activities };
  },
});

/* ------------------------------------------------------------------ */
/* brokerage-trading skill: preview -> confirm -> submit -> cancel     */
/* ------------------------------------------------------------------ */

export const brokerageOrderPreviewTool: HarnessTool = defineTool({
  name: "brokerage_order_preview",
  description:
    "Preview a single-leg stock/ETF order before submitting: estimated price, notional, commission, buying-power impact and warnings. Always preview before brokerage_order_submit.",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      accountId: { type: "string", description: "Optional; omit for the default account." },
      symbol: { type: "string", description: "Ticker, e.g. \"AAPL\"" },
      assetClass: { type: "string", enum: ["stock", "etf"], default: "stock" },
      side: { type: "string", enum: ["buy", "sell"] },
      type: { type: "string", enum: ["market", "limit"], default: "market" },
      qty: { type: "number", description: "Share quantity (positive).", exclusiveMinimum: 0 },
      limitPrice: { type: "number", description: "Required when type=limit." },
    },
    required: ["symbol", "side", "qty"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const symbol = requireString(args.symbol).toUpperCase();
    const side = requireString(args.side).toLowerCase() as "buy" | "sell";
    const type = (requireString(args.type) || "market").toLowerCase() as "market" | "limit";
    const qty = typeof args.qty === "number" ? args.qty : NaN;
    const limitPrice = typeof args.limitPrice === "number" ? args.limitPrice : undefined;
    if (!symbol) return { error: { kind: "input", message: "symbol is required" } };
    if (side !== "buy" && side !== "sell")
      return { error: { kind: "input", message: "side must be buy or sell" } };
    if (type !== "market" && type !== "limit")
      return { error: { kind: "input", message: "type must be market or limit" } };
    if (!Number.isFinite(qty) || qty <= 0)
      return { error: { kind: "input", message: "qty must be a positive number" } };
    if (type === "limit" && (!Number.isFinite(limitPrice) || (limitPrice as number) <= 0))
      return { error: { kind: "input", message: "limitPrice (positive) is required for limit orders" } };

    const r = await connectorCall("order_preview", {
      symbol,
      side,
      type,
      qty,
      limitPrice,
    });
    if (r.live) return r.data as Record<string, unknown>;

    const estPrice = type === "limit" ? (limitPrice as number) : mockPrice(symbol);
    const notional = Math.round(qty * estPrice * 100) / 100;
    const commission = 0; // zero-commission mock, aligned with retail brokers
    const warnings: string[] = [];
    if (side === "buy" && notional > MOCK_ACCOUNT.buyingPower) {
      warnings.push("notional exceeds buying power — submit would be rejected");
    }
    if (side === "sell") {
      const held = MOCK_POSITIONS.find((p) => p.symbol === symbol)?.qty ?? 0;
      if (qty > held) warnings.push(`selling ${qty} but only ${held} held (short not allowed in mock)`);
    }
    if (type === "market") warnings.push("market order: execution price may differ from estimate");
    return {
      mock: true,
      note: r.note,
      preview: {
        accountId: MOCK_ACCOUNT.accountId,
        symbol,
        assetClass: (requireString(args.assetClass) || "stock").toLowerCase(),
        side,
        type,
        qty,
        limitPrice: type === "limit" ? limitPrice : undefined,
        estimatedPrice: estPrice,
        notional,
        commission,
        estimatedTotal: Math.round((notional + commission) * 100) / 100,
        buyingPowerBefore: MOCK_ACCOUNT.buyingPower,
        buyingPowerAfter:
          side === "buy"
            ? Math.round((MOCK_ACCOUNT.buyingPower - notional) * 100) / 100
            : MOCK_ACCOUNT.buyingPower,
        warnings,
        confirmWith: "call brokerage_order_submit with the same args and confirm=true",
      },
    };
  },
});

export const brokerageOrderSubmitTool: HarnessTool = defineTool({
  name: "brokerage_order_submit",
  description:
    "STUB — submit a single-leg stock/ETF order through the enabled brokerage MCP Connector. Requires confirm=true (call brokerage_order_preview first and show the user). Without a live connector the order is recorded in the local mock book as pending-review, never executed.",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      accountId: { type: "string", description: "Optional; omit for the default account." },
      symbol: { type: "string", description: "Ticker, e.g. \"AAPL\"" },
      assetClass: { type: "string", enum: ["stock", "etf"], default: "stock" },
      side: { type: "string", enum: ["buy", "sell"] },
      type: { type: "string", enum: ["market", "limit"], default: "market" },
      qty: { type: "number", description: "Share quantity (positive).", exclusiveMinimum: 0 },
      limitPrice: { type: "number", description: "Required when type=limit." },
      confirm: {
        type: "boolean",
        description:
          "Must be true — confirms the user reviewed the preview and approves this order.",
      },
    },
    required: ["symbol", "side", "qty", "confirm"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const symbol = requireString(args.symbol).toUpperCase();
    const side = requireString(args.side).toLowerCase() as "buy" | "sell";
    const type = (requireString(args.type) || "market").toLowerCase() as "market" | "limit";
    const qty = typeof args.qty === "number" ? args.qty : NaN;
    const limitPrice = typeof args.limitPrice === "number" ? args.limitPrice : undefined;
    const confirm = args.confirm === true;

    if (!confirm) {
      return {
        stub: true,
        status: "needs_confirmation",
        message:
          "Order NOT submitted. Brokerage order submission requires explicit user confirmation: run brokerage_order_preview, show the preview to the user, then re-call brokerage_order_submit with confirm=true.",
        requested: { symbol, side, type, qty, limitPrice },
      };
    }
    if (!symbol) return { error: { kind: "input", message: "symbol is required" } };
    if (side !== "buy" && side !== "sell")
      return { error: { kind: "input", message: "side must be buy or sell" } };
    if (!Number.isFinite(qty) || qty <= 0)
      return { error: { kind: "input", message: "qty must be a positive number" } };
    if (type === "limit" && (!Number.isFinite(limitPrice) || (limitPrice as number) <= 0))
      return { error: { kind: "input", message: "limitPrice (positive) is required for limit orders" } };

    const r = await connectorCall("order_submit", {
      symbol,
      side,
      type,
      qty,
      limitPrice,
      confirm: true,
    });
    if (r.live) return r.data as Record<string, unknown>;

    const order: MockOrder = {
      orderId: makeOrderId(symbol),
      accountId: MOCK_ACCOUNT.accountId,
      symbol,
      assetClass: (requireString(args.assetClass) || "stock").toLowerCase() as "stock" | "etf",
      side,
      type,
      qty,
      limitPrice: type === "limit" ? limitPrice : undefined,
      status: "pending",
      submittedAt: Date.now(),
    };
    MOCK_ORDERS.unshift(order);
    return {
      stub: true,
      note: r.note,
      status: "accepted_pending_review",
      message:
        "Confirmed order recorded in the local mock book (no live connector). It is NOT executed; wire BROKERAGE_MCP_URL to a real brokerage connector to trade.",
      order,
    };
  },
});

export const brokerageOrderCancelTool: HarnessTool = defineTool({
  name: "brokerage_order_cancel",
  description:
    "STUB — cancel an open order by order id. Without a live MCP connector this flips local mock orders from open/pending to canceled and reports the transition; it never touches a real venue.",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      accountId: { type: "string", description: "Optional; omit for the default account." },
      orderId: { type: "string", description: "Order id from brokerage_orders_get / submit." },
    },
    required: ["orderId"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const orderId = requireString(args.orderId);
    if (!orderId) return { error: { kind: "input", message: "orderId is required" } };

    const r = await connectorCall("order_cancel", { orderId });
    if (r.live) return r.data as Record<string, unknown>;

    const order = MOCK_ORDERS.find((o) => o.orderId === orderId);
    if (!order) {
      return {
        stub: true,
        note: r.note,
        status: "not_found",
        message: `no order ${orderId} in the mock book; with a live connector cancellation would be forwarded to the broker`,
      };
    }
    if (order.status !== "open" && order.status !== "pending") {
      return {
        stub: true,
        note: r.note,
        status: "not_cancelable",
        message: `order ${orderId} is ${order.status}; only open/pending orders can be canceled`,
        order,
      };
    }
    order.status = "canceled";
    return {
      stub: true,
      note: r.note,
      status: "canceled",
      order,
    };
  },
});

export const brokerageTools: HarnessTool[] = [
  brokerageAccountsGetTool,
  brokeragePositionsGetTool,
  brokerageOrdersGetTool,
  brokerageActivitiesGetTool,
  brokerageOrderPreviewTool,
  brokerageOrderSubmitTool,
  brokerageOrderCancelTool,
];
