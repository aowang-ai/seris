/**
 * Prototype account information and local activity records. Returned
 * balances and account records are mock data, not brokerage balances.
 */

import { defineTool, type HarnessTool } from "./registry.js";

interface UserTag {
  key: string;
  value: string;
  updatedAt: number;
}

interface AccountState {
  userId: string;
  username: string;
  plan: "free" | "pro" | "institution";
  createdAt: number;
  /** Simulated balances; this account record does not report live holdings. */
  balances: { asset: string; available: number; locked: number }[];
  tags: Record<string, UserTag>;
}

interface Activity {
  id: string;
  ts: number;
  type:
    | "login"
    | "deposit"
    | "withdraw"
    | "order"
    | "tool_call"
    | "tag_update"
    | "settings"
    | "other";
  summary: string;
  meta?: Record<string, unknown>;
}

function now(): number {
  return Date.now();
}

function makeId(prefix: string): string {
  // 与 gateway 的 randomBytes token 同风格：非加密的短随机 id 足够本地流水用。
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Process-local mock account (deterministic across calls within a session). */
const ACCOUNT: AccountState = {
  userId: "u_mock_7f3a21",
  username: "seris-demo",
  plan: "pro",
  createdAt: now() - 1000 * 60 * 60 * 24 * 90,
  balances: [
    { asset: "USDC", available: 12_500.42, locked: 0 },
    { asset: "BTC", available: 0.2145, locked: 0.05 },
    { asset: "ETH", available: 3.158, locked: 0 },
  ],
  tags: {
    risk_profile: { key: "risk_profile", value: "balanced", updatedAt: now() },
    locale: { key: "locale", value: "zh-CN", updatedAt: now() },
  },
};

const ACTIVITIES: Activity[] = [];
let activitySeeded = false;

function seedActivities(): void {
  if (activitySeeded) return;
  activitySeeded = true;
  const t0 = now();
  ACTIVITIES.push(
    {
      id: makeId("act"),
      ts: t0 - 1000 * 60 * 5,
      type: "login",
      summary: "Simulated desktop sign-in",
    },
    {
      id: makeId("act"),
      ts: t0 - 1000 * 60 * 60 * 26,
      type: "deposit",
      summary: "Deposited 5,000 USDC",
      meta: { asset: "USDC", amount: 5000, network: "solana" },
    },
    {
      id: makeId("act"),
      ts: t0 - 1000 * 60 * 60 * 49,
      type: "order",
      summary: "Brokerage order filled: BUY 10 AAPL @ 232.41",
      meta: { symbol: "AAPL", side: "buy", qty: 10, price: 232.41 },
    },
    {
      id: makeId("act"),
      ts: t0 - 1000 * 60 * 60 * 73,
      type: "tag_update",
      summary: "User tag set: risk_profile=balanced",
      meta: { key: "risk_profile", value: "balanced" },
    },
    {
      id: makeId("act"),
      ts: t0 - 1000 * 60 * 60 * 90,
      type: "settings",
      summary: "Changed proactive agent cadence to 15m",
    },
  );
}

function recordActivity(a: Omit<Activity, "id" | "ts">): void {
  ACTIVITIES.unshift({ id: makeId("act"), ts: now(), ...a });
}

export const serisAccountTool: HarnessTool = defineTool({
  name: "seris_account",
  description:
    "Get the current Seris account: identity (user id, username, plan, age) plus balance overview and user tags. Balances are simulated local records, not live wallet totals.",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      include: {
        type: "array",
        items: {
          type: "string",
          enum: ["identity", "balances", "tags"],
        },
        description:
          "Sections to include; default all. Use [\"identity\"] when only who-the-user-is matters.",
      },
    },
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const include = (args.include as string[] | undefined) ?? [
      "identity",
      "balances",
      "tags",
    ];
    const out: Record<string, unknown> = { mock: true };
    if (include.includes("identity")) {
      out.identity = {
        userId: ACCOUNT.userId,
        username: ACCOUNT.username,
        plan: ACCOUNT.plan,
        createdAt: ACCOUNT.createdAt,
        accountAgeDays: Math.floor(
          (now() - ACCOUNT.createdAt) / (1000 * 60 * 60 * 24),
        ),
      };
    }
    if (include.includes("balances")) {
      out.balances = ACCOUNT.balances.map((b) => ({
        asset: b.asset,
        available: b.available,
        locked: b.locked,
        total: b.available + b.locked,
      }));
      out.balancesNote =
        "Simulated account balances; no live wallet or brokerage balance is connected";
    }
    if (include.includes("tags")) {
      out.tags = Object.fromEntries(
        Object.values(ACCOUNT.tags).map((t) => [t.key, t.value]),
      );
    }
    return out;
  },
});

export const serisActivitiesTool: HarnessTool = defineTool({
  name: "seris_activities",
  description:
    "List account activity history: logins, deposits, withdrawals, orders, tag updates, settings changes. Newest first. Filter by type and limit. Local mock ledger in offline-alpha.",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: [
          "login",
          "deposit",
          "withdraw",
          "order",
          "tool_call",
          "tag_update",
          "settings",
          "other",
        ],
        description: "Filter to one activity type; omit for all.",
      },
      limit: { type: "number", default: 20, minimum: 1, maximum: 100 },
    },
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    seedActivities();
    const type = args.type as string | undefined;
    const limit = Math.min(Math.max((args.limit as number | undefined) ?? 20, 1), 100);
    const rows = (type ? ACTIVITIES.filter((a) => a.type === type) : ACTIVITIES)
      .slice(0, limit)
      .map((a) => ({ ...a }));
    return {
      mock: true,
      total: type ? ACTIVITIES.filter((a) => a.type === type).length : ACTIVITIES.length,
      returned: rows.length,
      activities: rows,
    };
  },
});

export const setUserTagTool: HarnessTool = defineTool({
  name: "set_user_tag",
  description:
    "Set or update a tag on the current user (e.g. risk_profile=aggressive, preferred_quote=USDC). Tags feed personalization and skill routing. Persists for this session.",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description: "Tag key, snake_case, e.g. \"risk_profile\"",
        minLength: 1,
      },
      value: {
        type: "string",
        description: "Tag value, e.g. \"balanced\"",
        minLength: 1,
      },
    },
    required: ["key", "value"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const key = ((args.key as string | undefined) ?? "").trim();
    const value = ((args.value as string | undefined) ?? "").trim();
    if (!key || !value) {
      return {
        error: { kind: "input", message: "key and value are required non-empty strings" },
      };
    }
    seedActivities();
    const previous = ACCOUNT.tags[key]?.value ?? null;
    ACCOUNT.tags[key] = { key, value, updatedAt: now() };
    recordActivity({
      type: "tag_update",
      summary: `User tag set: ${key}=${value}`,
      meta: { key, value, previous },
    });
    return {
      ok: true,
      key,
      value,
      previous,
      updatedAt: ACCOUNT.tags[key].updatedAt,
    };
  },
});

export const accountTools: HarnessTool[] = [
  serisAccountTool,
  serisActivitiesTool,
  setUserTagTool,
];
