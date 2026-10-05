/**
 * Tools for reading, searching and updating local user, role and session
 * memory. Persistence and scoring are provided by MemoryStore.
 */

import {
  defaultMemoryStore,
  type MemoryLayer,
  type MemoryStore,
} from "../memory/store.js";
import { defineTool, type HarnessTool } from "./registry.js";

const LAYERS: MemoryLayer[] = ["personal", "role", "session", "compiled"];

function asLayer(v: unknown): MemoryLayer | undefined {
  return typeof v === "string" && (LAYERS as string[]).includes(v)
    ? (v as MemoryLayer)
    : undefined;
}

// ─── memory_search ──────────────────────────────────────────────────────────

export const memorySearchTool: HarnessTool = defineTool({
  name: "memory_search",
  description:
    "Search across all memory layers (personal / role / session / compiled_page). Uses keyword matching over local memory records.",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Free-text query. Substring + per-term weighted scoring." },
      layer: { type: "string", enum: LAYERS, description: "Restrict to one layer (optional)." },
      scope: {
        type: "string",
        description:
          "Restrict within a layer: roleId for role, sessionId for session, page slug for compiled, \"user\" for personal.",
      },
      limit: { type: "number", default: 10, minimum: 1, maximum: 50 },
      minScore: { type: "number", default: 0, minimum: 0, maximum: 1 },
    },
    required: ["query"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const query = ((args.query as string | undefined) ?? "").trim();
    if (!query) return { error: { kind: "input", message: "query is required" } };
    const layer = asLayer(args.layer);
    if (args.layer !== undefined && !layer) {
      return { error: { kind: "input", message: `layer must be one of ${LAYERS.join(",")}` } };
    }
    const hits = await defaultMemoryStore.search(query, {
      layer,
      scope: (args.scope as string | undefined)?.trim() || undefined,
      limit: clampInt(args.limit, 10, 1, 50),
      minScore: clampNum(args.minScore, 0, 0, 1),
    });
    return {
      store: storeInfo(),
      query,
      hits: hits.map(({ entry, score }) => ({
        id: entry.id,
        layer: entry.layer,
        scope: entry.scope,
        title: entry.title,
        score: Number(score.toFixed(3)),
        excerpt: excerpt(entry.body, query, 240),
        tags: entry.tags,
        updatedAt: entry.updatedAt,
      })),
      count: hits.length,
    };
  },
});

// ─── memory_write ───────────────────────────────────────────────────────────

export const memoryWriteTool: HarnessTool = defineTool({
  name: "memory_write",
  description:
    "Upsert a memory entry. Generic writer for any layer — Use layer=personal for user preferences, role_memory_store for role notes, and session_memory for conversation working memory.",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      layer: { type: "string", enum: LAYERS },
      scope: {
        type: "string",
        description: "roleId / sessionId / page-slug / \"user\" depending on layer.",
      },
      title: { type: "string" },
      body: { type: "string", description: "Free-form Markdown body." },
      tags: { type: "array", items: { type: "string" }, default: [] },
      id: { type: "string", description: "Optional explicit id for idempotent upsert." },
    },
    required: ["layer", "scope", "title", "body"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const layer = asLayer(args.layer);
    const scope = ((args.scope as string | undefined) ?? "").trim();
    const title = ((args.title as string | undefined) ?? "").trim();
    const body = (args.body as string | undefined) ?? "";
    if (!layer) return { error: { kind: "input", message: `layer must be one of ${LAYERS.join(",")}` } };
    if (!scope) return { error: { kind: "input", message: "scope is required" } };
    if (!title) return { error: { kind: "input", message: "title is required" } };
    const tags = Array.isArray(args.tags) ? (args.tags as unknown[]).filter((t): t is string => typeof t === "string") : [];
    const entry = await defaultMemoryStore.write({
      layer,
      scope,
      title,
      body,
      tags,
      id: (args.id as string | undefined)?.trim() || undefined,
      source: "memory_write",
    });
    return { ok: true, id: entry.id, entry };
  },
});

// ─── memory_read ────────────────────────────────────────────────────────────

export const memoryReadTool: HarnessTool = defineTool({
  name: "memory_read",
  description:
    "Read memories by id, or list a whole layer/scope. Use memory_search when you don't know the id; use this when you do, or to enumerate a scope.",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Exact entry id (e.g. \"personal:user:risk-tolerance\")" },
      layer: { type: "string", enum: LAYERS },
      scope: { type: "string" },
      limit: { type: "number", default: 50, minimum: 1, maximum: 200 },
    },
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const id = (args.id as string | undefined)?.trim();
    if (id) {
      const entry = await defaultMemoryStore.get(id);
      return entry ? { found: true, entry } : { found: false, id };
    }
    const layer = asLayer(args.layer);
    if (args.layer !== undefined && !layer) {
      return { error: { kind: "input", message: `layer must be one of ${LAYERS.join(",")}` } };
    }
    const entries = await defaultMemoryStore.list({
      layer,
      scope: (args.scope as string | undefined)?.trim() || undefined,
      limit: clampInt(args.limit, 50, 1, 200),
    });
    return { found: entries.length > 0, count: entries.length, entries };
  },
});

// ─── memory_compiled_page ───────────────────────────────────────────────────

export const memoryCompiledPageTool: HarnessTool = defineTool({
  name: "memory_compiled_page",
  description:
    "Read one compiled_page — a frozen, agent-authored summary document (e.g. \"user-profile\", \"current-portfolio\", \"research-digest\"). Compiled pages are written by the agent itself via memory_write with layer=\"compiled\".",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      slug: { type: "string", description: "Compiled-page slug, e.g. \"user-profile\"" },
    },
    required: ["slug"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const slug = ((args.slug as string | undefined) ?? "").trim().toLowerCase();
    if (!slug) return { error: { kind: "input", message: "slug is required" } };
    const entry = await defaultMemoryStore.getCompiledPage(slug);
    if (!entry) return { found: false, slug };
    return {
      found: true,
      slug,
      title: entry.title,
      body: entry.body,
      tags: entry.tags,
      updatedAt: entry.updatedAt,
    };
  },
});

// ─── role_memory_recall / role_memory_store ─────────────────────────────────

export const roleMemoryRecallTool: HarnessTool = defineTool({
  name: "role_memory_recall",
  description:
    "Recall all memories attached to a role (persona / strategy the agent is playing — e.g. \"quant-trader\", \"risk-officer\"). Used when a role is (re)activated so it boots with its accumulated expertise.",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      roleId: { type: "string", description: "Role identifier, e.g. \"quant-trader\"" },
      query: {
        type: "string",
        description: "Optional query to rank/filter within the role's memories.",
      },
      limit: { type: "number", default: 20, minimum: 1, maximum: 100 },
    },
    required: ["roleId"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const roleId = ((args.roleId as string | undefined) ?? "").trim();
    if (!roleId) return { error: { kind: "input", message: "roleId is required" } };
    const query = (args.query as string | undefined)?.trim();
    const limit = clampInt(args.limit, 20, 1, 100);
    if (query) {
      const hits = await defaultMemoryStore.search(query, {
        layer: "role",
        scope: roleId,
        limit,
      });
      return {
        roleId,
        query,
        count: hits.length,
        memories: hits.map(({ entry, score }) => ({ ...entry, score: Number(score.toFixed(3)) })),
      };
    }
    const entries = await defaultMemoryStore.list({ layer: "role", scope: roleId, limit });
    return { roleId, count: entries.length, memories: entries };
  },
});

export const roleMemoryStoreTool: HarnessTool = defineTool({
  name: "role_memory_store",
  description:
    "Store a memory under a roleId. Role memories hold role-specific expertise (\"momentum regime favors 4h BTC re-entries\") that should persist separately from the user's personal facts.",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      roleId: { type: "string" },
      title: { type: "string" },
      body: { type: "string" },
      tags: { type: "array", items: { type: "string" }, default: [] },
    },
    required: ["roleId", "title", "body"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const roleId = ((args.roleId as string | undefined) ?? "").trim();
    const title = ((args.title as string | undefined) ?? "").trim();
    const body = (args.body as string | undefined) ?? "";
    if (!roleId) return { error: { kind: "input", message: "roleId is required" } };
    if (!title) return { error: { kind: "input", message: "title is required" } };
    const tags = Array.isArray(args.tags) ? (args.tags as unknown[]).filter((t): t is string => typeof t === "string") : [];
    const entry = await defaultMemoryStore.write({
      layer: "role",
      scope: roleId,
      title,
      body,
      tags,
      source: "role_memory_store",
    });
    return { ok: true, roleId, id: entry.id, entry };
  },
});

// ─── session_memory ─────────────────────────────────────────────────────────

export const sessionMemoryTool: HarnessTool = defineTool({
  name: "session_memory",
  description:
    "Working memory for the current conversation. action=\"write\" upserts, action=\"read\" lists, action=\"clear\" wipes the whole session scope. Session memories are short-lived and isolated by sessionId.",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["write", "read", "clear"] },
      sessionId: { type: "string", description: "Conversation / session id." },
      key: { type: "string", description: "Required for action=write — short label for the slot." },
      value: { type: "string", description: "Required for action=write — the content." },
      tags: { type: "array", items: { type: "string" }, default: [] },
      limit: { type: "number", default: 50, minimum: 1, maximum: 200 },
    },
    required: ["action", "sessionId"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const action = (args.action as string | undefined) ?? "";
    const sessionId = ((args.sessionId as string | undefined) ?? "").trim();
    if (!sessionId) return { error: { kind: "input", message: "sessionId is required" } };
    if (action === "write") {
      const key = ((args.key as string | undefined) ?? "").trim();
      const value = (args.value as string | undefined) ?? "";
      if (!key) return { error: { kind: "input", message: "key is required for action=write" } };
      const tags = Array.isArray(args.tags) ? (args.tags as unknown[]).filter((t): t is string => typeof t === "string") : [];
      const entry = await defaultMemoryStore.write({
        layer: "session",
        scope: sessionId,
        title: key,
        body: value,
        tags,
        source: "session_memory",
      });
      return { ok: true, action, sessionId, id: entry.id };
    }
    if (action === "read") {
      const entries = await defaultMemoryStore.list({
        layer: "session",
        scope: sessionId,
        limit: clampInt(args.limit, 50, 1, 200),
      });
      return { ok: true, action, sessionId, count: entries.length, entries };
    }
    if (action === "clear") {
      const removed = await defaultMemoryStore.clearScope("session", sessionId);
      return { ok: true, action, sessionId, removed };
    }
    return { error: { kind: "input", message: "action must be one of write,read,clear" } };
  },
});

// ─── write_personalization_memory / personalization_snapshot ────────────────

export const writePersonalizationMemoryTool: HarnessTool = defineTool({
  name: "write_personalization_memory",
  description:
    "High-level writer for the personalization pipeline — records a learned fact about the user (preference, risk tolerance, portfolio composition, style note). Always writes to layer=personal, scope=\"user\".",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      fact: { type: "string", description: "Short title of the fact, e.g. \"Risk tolerance: conservative\"" },
      detail: { type: "string", description: "One- or two-sentence explanation / evidence." },
      category: {
        type: "string",
        enum: ["preference", "risk", "portfolio", "style", "identity", "other"],
        default: "other",
      },
      tags: { type: "array", items: { type: "string" }, default: [] },
    },
    required: ["fact", "detail"],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const fact = ((args.fact as string | undefined) ?? "").trim();
    const detail = ((args.detail as string | undefined) ?? "").trim();
    if (!fact) return { error: { kind: "input", message: "fact is required" } };
    const category = ((args.category as string | undefined) ?? "other").toLowerCase();
    const tags = [
      `category:${category}`,
      ...(Array.isArray(args.tags) ? (args.tags as unknown[]).filter((t): t is string => typeof t === "string") : []),
    ];
    const entry = await defaultMemoryStore.write({
      layer: "personal",
      scope: "user",
      title: fact,
      body: detail,
      tags,
      source: "write_personalization_memory",
    });
    return { ok: true, id: entry.id, entry };
  },
});

export const personalizationSnapshotTool: HarnessTool = defineTool({
  name: "personalization_snapshot",
  description:
    "Dump a personalization snapshot: store stats (counts per layer, file size, path) plus the most recent personal facts about the user. Used by the system-prompt builder to inject a compact personalization block.",
  category: "memory",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", default: 10, minimum: 1, maximum: 50 },
    },
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const limit = clampInt(args.limit, 10, 1, 50);
    const [stats, recent] = await Promise.all([
      defaultMemoryStore.stats(),
      defaultMemoryStore.list({ layer: "personal", scope: "user", limit }),
    ]);
    return {
      store: storeInfo(),
      stats,
      recentPersonalFacts: recent.map((e) => ({
        id: e.id,
        title: e.title,
        body: e.body,
        tags: e.tags,
        updatedAt: e.updatedAt,
      })),
      count: recent.length,
    };
  },
});

// ─── helpers ────────────────────────────────────────────────────────────────

function storeInfo() {
  return {
    backend: "json-file",
    note: "production: sqlite-vec; scorer interface is identical",
  };
}

function clampInt(v: unknown, def: number, lo: number, hi: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.min(hi, Math.max(lo, n));
}

function clampNum(v: unknown, def: number, lo: number, hi: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : def;
  return Math.min(hi, Math.max(lo, n));
}

/** Compact excerpt around the first query hit, for search results. */
function excerpt(body: string, query: string, width: number): string {
  const q = query.toLowerCase().split(/\s+/)[0];
  const idx = q ? body.toLowerCase().indexOf(q) : -1;
  if (idx < 0) return body.slice(0, width) + (body.length > width ? "…" : "");
  const start = Math.max(0, idx - width / 3);
  const end = Math.min(body.length, start + width);
  return (
    (start > 0 ? "…" : "") +
    body.slice(start, end) +
    (end < body.length ? "…" : "")
  );
}

export const memoryTools: HarnessTool[] = [
  memorySearchTool,
  memoryWriteTool,
  memoryReadTool,
  memoryCompiledPageTool,
  roleMemoryRecallTool,
  roleMemoryStoreTool,
  sessionMemoryTool,
  writePersonalizationMemoryTool,
  personalizationSnapshotTool,
];

export { defaultMemoryStore };
export type { MemoryStore };
