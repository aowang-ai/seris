/**
 * Prototype perpetual wallet inspection and simulated transfers. These
 * tools return mock data and never sign or broadcast a transaction.
 */

import { defineTool, type HarnessTool } from "./registry.js";

/* ------------------------------------------------------------------ */
/* Mock ledger — deterministic in-memory perp sub-accounts.            */
/* ------------------------------------------------------------------ */

interface MockPerpWallet {
  walletId: string;
  label: string;
  address: string;
  venue: "hyperliquid" | "lighter";
  createdAt: string;
  equityUsd: number;
  availableUsd: number;
  marginUsedUsd: number;
  unrealizedPnlUsd: number;
  positions: Array<{
    market: string;
    side: "long" | "short";
    size: number;
    entryPrice: number;
    markPrice: number;
    leverage: number;
    liquidationPrice: number;
    unrealizedPnlUsd: number;
    fundingPnlUsd: number;
  }>;
}

const MOCK_WALLETS: MockPerpWallet[] = [
  {
    walletId: "perp_wallet_main",
    label: "Main",
    address: "0x3f1a9c04b7d2e8a156f0c44d5b6e90728acdf011",
    venue: "hyperliquid",
    createdAt: "2026-01-12T08:30:00.000Z",
    equityUsd: 12483.55,
    availableUsd: 8920.10,
    marginUsedUsd: 3563.45,
    unrealizedPnlUsd: 412.38,
    positions: [
      {
        market: "BTC-USD",
        side: "long",
        size: 0.12,
        entryPrice: 97250.0,
        markPrice: 99680.0,
        leverage: 5,
        liquidationPrice: 78210.0,
        unrealizedPnlUsd: 291.6,
        fundingPnlUsd: -8.42,
      },
      {
        market: "ETH-USD",
        side: "long",
        size: 2.5,
        entryPrice: 3420.0,
        markPrice: 3468.3,
        leverage: 3,
        liquidationPrice: 2299.0,
        unrealizedPnlUsd: 120.75,
        fundingPnlUsd: 3.18,
      },
    ],
  },
  {
    walletId: "perp_wallet_scalp",
    label: "Scalping",
    address: "0x8be244d1c6aa30f79b51c8e6d220f4a05c19db77",
    venue: "lighter",
    createdAt: "2026-03-02T14:05:00.000Z",
    equityUsd: 2510.0,
    availableUsd: 2510.0,
    marginUsedUsd: 0,
    unrealizedPnlUsd: 0,
    positions: [],
  },
];

interface MockFill {
  fillId: string;
  walletId: string;
  market: string;
  side: "buy" | "sell";
  size: number;
  price: number;
  feeUsd: number;
  realizedPnlUsd: number;
  closedBy: "taker" | "maker" | "liquidation";
  time: string;
}

const MOCK_FILLS: MockFill[] = [
  {
    fillId: "fill_0001",
    walletId: "perp_wallet_main",
    market: "BTC-USD",
    side: "buy",
    size: 0.12,
    price: 97250.0,
    feeUsd: 5.84,
    realizedPnlUsd: 0,
    closedBy: "taker",
    time: "2026-09-24T11:42:17.000Z",
  },
  {
    fillId: "fill_0002",
    walletId: "perp_wallet_main",
    market: "ETH-USD",
    side: "buy",
    size: 2.5,
    price: 3420.0,
    feeUsd: 3.42,
    realizedPnlUsd: 0,
    closedBy: "maker",
    time: "2026-09-25T02:11:03.000Z",
  },
  {
    fillId: "fill_0003",
    walletId: "perp_wallet_main",
    market: "SOL-USD",
    side: "sell",
    size: 40,
    price: 208.15,
    feeUsd: 4.16,
    realizedPnlUsd: 386.0,
    closedBy: "taker",
    time: "2026-09-26T18:03:55.000Z",
  },
  {
    fillId: "fill_0004",
    walletId: "perp_wallet_scalp",
    market: "DOGE-USD",
    side: "sell",
    size: 5000,
    price: 0.1924,
    feeUsd: 0.48,
    realizedPnlUsd: -21.5,
    closedBy: "taker",
    time: "2026-09-27T09:28:41.000Z",
  },
];

/** Deterministic pseudo-walk for daily pnl snapshots. */
function mockDailyPnl(wallet: MockPerpWallet, days: number) {
  const out: Array<{ date: string; realizedUsd: number; unrealizedUsd: number; fundingUsd: number; equityUsd: number }> = [];
  let equity = wallet.equityUsd - wallet.unrealizedPnlUsd - days * 14.7;
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const realized = Math.round(((i * 7919 + wallet.walletId.length * 131) % 200 - 95) * 100) / 100;
    const funding = Math.round(((i * 104729) % 21 - 10) * 0.42 * 100) / 100;
    equity = Math.round((equity + realized + funding) * 100) / 100;
    out.push({
      date: new Date(now - i * 86_400_000).toISOString().slice(0, 10),
      realizedUsd: realized,
      unrealizedUsd: i === 0 ? wallet.unrealizedPnlUsd : 0,
      fundingUsd: funding,
      equityUsd: equity,
    });
  }
  return out;
}

function walletNotFound(walletId: string) {
  return {
    error: {
      kind: "not-found",
      message: `perps wallet "${walletId}" does not exist`,
      known: MOCK_WALLETS.map((w) => w.walletId),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

export const serisPerpsWalletsListTool: HarnessTool = defineTool({
  name: "seris_perps_wallets_list",
  description:
    "MOCK — list the user's perpetual-trading sub-accounts (perps wallets) with label, address, venue, equity and open position count.",
  category: "portfolio",
  parameters: {
    type: "object",
    properties: {
      venue: {
        type: "string",
        enum: ["hyperliquid", "lighter", "all"],
        default: "all",
        description: "Optional venue filter.",
      },
    },
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const venue = ((args.venue as string | undefined) ?? "all").toLowerCase();
    const wallets = MOCK_WALLETS.filter(
      (w) => venue === "all" || w.venue === venue,
    ).map((w) => ({
      walletId: w.walletId,
      label: w.label,
      address: w.address,
      venue: w.venue,
      createdAt: w.createdAt,
      equityUsd: w.equityUsd,
      availableUsd: w.availableUsd,
      openPositions: w.positions.length,
    }));
    return { mock: true, count: wallets.length, wallets };
  },
});

export const resolvePerpsWalletTool: HarnessTool = defineTool({
  name: "resolve_perps_wallet",
  description:
    "Resolve a perps wallet reference — walletId, label, address, or 'default' — to a canonical wallet descriptor. Use before summary/fills/pnl calls when the user names a wallet loosely.",
  category: "portfolio",
  parameters: {
    type: "object",
    properties: {
      ref: {
        type: "string",
        description: "walletId (perp_wallet_main), label (\"Main\"), address (0x…), or \"default\".",
        default: "default",
      },
    },
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const ref = ((args.ref as string | undefined) ?? "default").trim();
    const lc = ref.toLowerCase();
    let w: MockPerpWallet | undefined;
    if (ref === "" || lc === "default") {
      w = MOCK_WALLETS[0];
    } else {
      w =
        MOCK_WALLETS.find((x) => x.walletId.toLowerCase() === lc) ??
        MOCK_WALLETS.find((x) => x.label.toLowerCase() === lc) ??
        MOCK_WALLETS.find((x) => x.address.toLowerCase() === lc);
    }
    if (!w) return walletNotFound(ref);
    return {
      mock: true,
      resolvedFrom: ref || "default",
      wallet: {
        walletId: w.walletId,
        label: w.label,
        address: w.address,
        venue: w.venue,
      },
    };
  },
});

export const serisPerpsWalletSummaryTool: HarnessTool = defineTool({
  name: "seris_perps_wallet_summary",
  description:
    "MOCK — equity / available balance / margin usage / unrealized PnL and open positions for one perps wallet.",
  category: "portfolio",
  parameters: {
    type: "object",
    properties: {
      walletId: { type: "string", description: "Perps wallet id, e.g. \"perp_wallet_main\". Resolve via resolve_perps_wallet when unsure." },
    },
    required: ["walletId"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const walletId = (args.walletId as string | undefined) ?? "";
    const w = MOCK_WALLETS.find((x) => x.walletId === walletId);
    if (!w) return walletNotFound(walletId);
    return {
      mock: true,
      walletId: w.walletId,
      label: w.label,
      venue: w.venue,
      address: w.address,
      equityUsd: w.equityUsd,
      availableUsd: w.availableUsd,
      marginUsedUsd: w.marginUsedUsd,
      marginRatio: w.equityUsd > 0 ? Math.round((w.marginUsedUsd / w.equityUsd) * 10_000) / 10_000 : 0,
      unrealizedPnlUsd: w.unrealizedPnlUsd,
      positions: w.positions,
    };
  },
});

export const serisPerpsWalletFillsTool: HarnessTool = defineTool({
  name: "seris_perps_wallet_fills",
  description:
    "MOCK — recent trade fills for a perps wallet: side, size, price, fee, realized PnL, taker/maker, time. Newest first.",
  category: "portfolio",
  parameters: {
    type: "object",
    properties: {
      walletId: { type: "string", description: "Perps wallet id." },
      market: { type: "string", description: "Optional market filter, e.g. \"BTC-USD\"." },
      limit: { type: "number", default: 25, minimum: 1, maximum: 200 },
    },
    required: ["walletId"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const walletId = (args.walletId as string | undefined) ?? "";
    const market = (args.market as string | undefined)?.toUpperCase().trim();
    const limit = Math.min(Math.max((args.limit as number | undefined) ?? 25, 1), 200);
    const w = MOCK_WALLETS.find((x) => x.walletId === walletId);
    if (!w) return walletNotFound(walletId);
    const fills = MOCK_FILLS
      .filter((f) => f.walletId === walletId)
      .filter((f) => !market || f.market === market)
      .slice(0, limit);
    return { mock: true, walletId, count: fills.length, fills };
  },
});

export const serisPerpsWalletPnlTool: HarnessTool = defineTool({
  name: "seris_perps_wallet_pnl",
  description:
    "MOCK — PnL breakdown for one perps wallet over a lookback window: totals (realized/unrealized/funding/fees/net) plus a daily equity series.",
  category: "portfolio",
  parameters: {
    type: "object",
    properties: {
      walletId: { type: "string", description: "Perps wallet id." },
      days: { type: "number", default: 30, minimum: 1, maximum: 180, description: "Lookback window in days." },
    },
    required: ["walletId"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const walletId = (args.walletId as string | undefined) ?? "";
    const days = Math.min(Math.max((args.days as number | undefined) ?? 30, 1), 180);
    const w = MOCK_WALLETS.find((x) => x.walletId === walletId);
    if (!w) return walletNotFound(walletId);
    const daily = mockDailyPnl(w, days);
    const realizedUsd = Math.round(daily.reduce((s, d) => s + d.realizedUsd, 0) * 100) / 100;
    const fundingUsd = Math.round(daily.reduce((s, d) => s + d.fundingUsd, 0) * 100) / 100;
    const feesUsd = Math.round(
      MOCK_FILLS.filter((f) => f.walletId === walletId).reduce((s, f) => s + f.feeUsd, 0) * 100,
    ) / 100;
    return {
      mock: true,
      walletId,
      days,
      totals: {
        realizedUsd,
        unrealizedUsd: w.unrealizedPnlUsd,
        fundingUsd,
        feesUsd,
        netUsd: Math.round((realizedUsd + w.unrealizedPnlUsd + fundingUsd - feesUsd) * 100) / 100,
      },
      daily,
    };
  },
});

export const serisWalletFundPerpTool: HarnessTool = defineTool({
  name: "seris_wallet_fund_perp",
  description:
    "STUB — transfer USDC from the spot wallet into a perps wallet's margin account. Production flow requires wallet signing; this stub validates inputs and returns a simulated transfer receipt (nothing moves).",
  category: "portfolio",
  parameters: {
    type: "object",
    properties: {
      walletId: { type: "string", description: "Destination perps wallet id." },
      amountUsd: { type: "number", description: "Amount of USDC to move from spot to perp.", exclusiveMinimum: 0 },
    },
    required: ["walletId", "amountUsd"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const walletId = (args.walletId as string | undefined) ?? "";
    const amount = args.amountUsd as number | undefined;
    const w = MOCK_WALLETS.find((x) => x.walletId === walletId);
    if (!w) return walletNotFound(walletId);
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return { error: { kind: "input", message: "amountUsd must be a positive number" } };
    }
    return {
      stub: true,
      reason: "real funding requires spot-wallet signing and custodial ledger writes; simulated only",
      direction: "spot->perp",
      asset: "USDC",
      walletId,
      amountUsd: Math.round(amount * 100) / 100,
      simulatedReceipt: {
        transferId: `sim_transfer_${Math.abs(hashCode(`${walletId}:${amount}`)).toString(16)}`,
        status: "simulated",
        resultingEquityUsd: Math.round((w.equityUsd + amount) * 100) / 100,
        settledAt: null,
      },
    };
  },
});

export const serisWalletWithdrawToSpotTool: HarnessTool = defineTool({
  name: "seris_wallet_withdraw_to_spot",
  description:
    "STUB — withdraw USDC from a perps wallet back to the spot wallet. Production flow checks free margin and requires signing; this stub validates available balance and returns a simulated receipt (nothing moves).",
  category: "portfolio",
  parameters: {
    type: "object",
    properties: {
      walletId: { type: "string", description: "Source perps wallet id." },
      amountUsd: { type: "number", description: "Amount of USDC to move back to spot.", exclusiveMinimum: 0 },
    },
    required: ["walletId", "amountUsd"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const walletId = (args.walletId as string | undefined) ?? "";
    const amount = args.amountUsd as number | undefined;
    const w = MOCK_WALLETS.find((x) => x.walletId === walletId);
    if (!w) return walletNotFound(walletId);
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return { error: { kind: "input", message: "amountUsd must be a positive number" } };
    }
    if (amount > w.availableUsd) {
      return {
        error: {
          kind: "insufficient-balance",
          message: `requested ${amount} USDC exceeds available ${w.availableUsd} USDC (margin used ${w.marginUsedUsd} USDC)`,
          availableUsd: w.availableUsd,
        },
      };
    }
    return {
      stub: true,
      reason: "real withdrawal requires margin checks and signing; simulated only",
      direction: "perp->spot",
      asset: "USDC",
      walletId,
      amountUsd: Math.round(amount * 100) / 100,
      simulatedReceipt: {
        transferId: `sim_transfer_${Math.abs(hashCode(`${walletId}:${amount}:out`)).toString(16)}`,
        status: "simulated",
        resultingAvailableUsd: Math.round((w.availableUsd - amount) * 100) / 100,
        settledAt: null,
      },
    };
  },
});

export const serisPnlTool: HarnessTool = defineTool({
  name: "seris_pnl",
  description:
    "MOCK — aggregated PnL across all perps wallets (or one, if walletId given): realized, unrealized, funding, fees, net, and win/loss stats from fills.",
  category: "portfolio",
  parameters: {
    type: "object",
    properties: {
      walletId: { type: "string", description: "Optional: scope to one perps wallet; omitted = all wallets." },
      days: { type: "number", default: 30, minimum: 1, maximum: 180 },
    },
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const walletId = args.walletId as string | undefined;
    const days = Math.min(Math.max((args.days as number | undefined) ?? 30, 1), 180);
    const wallets = walletId
      ? MOCK_WALLETS.filter((x) => x.walletId === walletId)
      : MOCK_WALLETS;
    if (walletId && wallets.length === 0) return walletNotFound(walletId);

    const fills = MOCK_FILLS.filter((f) => wallets.some((w) => w.walletId === f.walletId));
    const closing = fills.filter((f) => f.realizedPnlUsd !== 0);
    const winners = closing.filter((f) => f.realizedPnlUsd > 0);
    const realizedUsd = Math.round(closing.reduce((s, f) => s + f.realizedPnlUsd, 0) * 100) / 100;
    const feesUsd = Math.round(fills.reduce((s, f) => s + f.feeUsd, 0) * 100) / 100;
    const unrealizedUsd = Math.round(wallets.reduce((s, w) => s + w.unrealizedPnlUsd, 0) * 100) / 100;
    const fundingUsd = Math.round(
      wallets.flatMap((w) => mockDailyPnl(w, days)).reduce((s, d) => s + d.fundingUsd, 0) * 100,
    ) / 100;

    return {
      mock: true,
      scope: walletId ?? "all",
      days,
      totals: {
        realizedUsd,
        unrealizedUsd,
        fundingUsd,
        feesUsd,
        netUsd: Math.round((realizedUsd + unrealizedUsd + fundingUsd - feesUsd) * 100) / 100,
      },
      stats: {
        closingTrades: closing.length,
        winningTrades: winners.length,
        winRate: closing.length > 0 ? Math.round((winners.length / closing.length) * 10_000) / 10_000 : null,
        avgWinUsd: winners.length > 0
          ? Math.round((winners.reduce((s, f) => s + f.realizedPnlUsd, 0) / winners.length) * 100) / 100
          : null,
        bestTradeUsd: closing.length > 0 ? Math.max(...closing.map((f) => f.realizedPnlUsd)) : null,
        worstTradeUsd: closing.length > 0 ? Math.min(...closing.map((f) => f.realizedPnlUsd)) : null,
      },
    };
  },
});

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

export const perpWalletTools: HarnessTool[] = [
  serisPerpsWalletsListTool,
  resolvePerpsWalletTool,
  serisPerpsWalletSummaryTool,
  serisPerpsWalletFillsTool,
  serisPerpsWalletPnlTool,
  serisWalletFundPerpTool,
  serisWalletWithdrawToSpotTool,
  serisPnlTool,
];
