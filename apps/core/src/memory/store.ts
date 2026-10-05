/**
 * Local memory persistence for user facts, role notes, session notes and
 * compiled documents. Entries are stored in .data/memory.json and ranked
 * using deterministic phrase, keyword and tag matches.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { dataPath } from "../runtime/paths.js";

export type MemoryLayer = "personal" | "role" | "session" | "compiled";

export interface MemoryEntry {
  /** Stable id within the store — `${layer}:${scope}:${slug}` */
  id: string;
  layer: MemoryLayer;
  /**
   * Scope within the layer:
   *   personal → "user" (single local user)
   *   role     → roleId ("quant-trader", ...)
   *   session  → sessionId
   *   compiled → page slug ("user-profile", "bookmarks", ...)
   */
  scope: string;
  /** Human/agent-readable title — indexed for search. */
  title: string;
  /** The memory body — free-form Markdown / text. */
  body: string;
  /** Free-form tags for coarse filtering. */
  tags: string[];
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  /** Provenance — which tool / pipeline wrote this. */
  source?: string;
}

export interface StoreFile {
  version: 1;
  entries: MemoryEntry[];
}

export interface SearchHit {
  entry: MemoryEntry;
  /**
   * Score 0..1. Higher is better. The production version swaps
   * this for sqlite-vec cosine similarity; we keep substring/keyword
   * here so local retrieval is offline and deterministic.
   */
  score: number;
}

export interface SearchOptions {
  /** Restrict to one layer, otherwise search all three+compiled. */
  layer?: MemoryLayer;
  /** Restrict to one scope (roleId / sessionId / page slug / "user"). */
  scope?: string;
  /** Cap result count. Default 10. */
  limit?: number;
  /** Only return hits with score >= minScore. Default 0 (return everything ranked). */
  minScore?: number;
}

const SAVE_DEBOUNCE_MS = 150;
const MAX_BODY_BYTES = 256 * 1024; // guard against runaway writes

export class MemoryStore {
  private file: StoreFile = { version: 1, entries: [] };
  private loaded = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private get path(): string { return this.filePath ?? dataPath("memory.json"); }

  constructor(private readonly filePath?: string) {}

  // ─── lifecycle ────────────────────────────────────────────────────────────

  /** Idempotent lazy load. Missing file = empty store, not an error. */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as StoreFile;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
        this.file = parsed;
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        // Corrupted file: keep going with an empty in-memory store; the next
        // save will overwrite. Surface via stderr so an operator can restore.
        console.error(`[memory] failed to load ${this.path}: ${String(err)}`);
      }
    }
  }

  /** Force a synchronous-ish flush — used at shutdown and in tests. */
  async flush(): Promise<void> {
    if (!this.loaded) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.writeNow();
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.writeNow().catch(error => console.error(`[memory] failed to save: ${String(error)}`));
    }, SAVE_DEBOUNCE_MS);
  }

  private async writeNow(): Promise<void> {
    await fs.mkdir(path.dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(this.file, null, 2), "utf8");
    await fs.rename(tmp, this.path);
  }

  // ─── write ────────────────────────────────────────────────────────────────

  /**
   * Upsert an entry. If `id` is omitted, we derive one from (layer, scope, title).
   * Returns the final entry (with id and timestamps set).
   */
  async write(input: {
    layer: MemoryLayer;
    scope: string;
    title: string;
    body: string;
    tags?: string[];
    id?: string;
    source?: string;
  }): Promise<MemoryEntry> {
    await this.ensureLoaded();
    const now = new Date().toISOString();
    const body = clampBody(input.body);
    const id =
      input.id ??
      deriveId(input.layer, input.scope, input.title);
    const existingIdx = this.file.entries.findIndex((e) => e.id === id);
    const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean);
    const entry: MemoryEntry = existingIdx >= 0
      ? {
          ...this.file.entries[existingIdx],
          title: input.title,
          body,
          tags,
          updatedAt: now,
          source: input.source ?? this.file.entries[existingIdx].source,
        }
      : {
          id,
          layer: input.layer,
          scope: input.scope,
          title: input.title,
          body,
          tags,
          createdAt: now,
          updatedAt: now,
          source: input.source,
        };
    if (existingIdx >= 0) this.file.entries[existingIdx] = entry;
    else this.file.entries.push(entry);
    this.scheduleSave();
    return entry;
  }

  /** Remove a single entry by id. No-op if missing. */
  async delete(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const before = this.file.entries.length;
    this.file.entries = this.file.entries.filter((e) => e.id !== id);
    if (this.file.entries.length !== before) {
      this.scheduleSave();
      return true;
    }
    return false;
  }

  /** Drop an entire scope (e.g. a finished session). */
  async clearScope(layer: MemoryLayer, scope: string): Promise<number> {
    await this.ensureLoaded();
    const before = this.file.entries.length;
    this.file.entries = this.file.entries.filter(
      (e) => !(e.layer === layer && e.scope === scope),
    );
    const removed = before - this.file.entries.length;
    if (removed > 0) this.scheduleSave();
    return removed;
  }

  // ─── read / search ────────────────────────────────────────────────────────

  async get(id: string): Promise<MemoryEntry | undefined> {
    await this.ensureLoaded();
    return this.file.entries.find((e) => e.id === id);
  }

  /** Layer/scoped read — used by memory_read when it wants everything in a scope. */
  async list(filter: { layer?: MemoryLayer; scope?: string; limit?: number } = {}): Promise<MemoryEntry[]> {
    await this.ensureLoaded();
    let out = this.file.entries.slice();
    if (filter.layer) out = out.filter((e) => e.layer === filter.layer);
    if (filter.scope) out = out.filter((e) => e.scope === filter.scope);
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (filter.limit && filter.limit > 0) out = out.slice(0, filter.limit);
    return out;
  }

  /**
   * Substring/keyword scorer.
   *
   * score(haystack, terms):
   *   - exact phrase bonus       (whole query appears in title/body)   +0.5
   *   - per-term hit in title                                        +0.2
   *   - per-term hit in tags                                         +0.15
   *   - per-term hit in body                                         +0.1
   * capped at 1.0. Deterministic and explainable — production swaps this
   * for sqlite-vec cosine but the calling convention stays identical.
   */
  async search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    await this.ensureLoaded();
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/\s+/).filter(Boolean);
    const limit = opts.limit ?? 10;
    const minScore = opts.minScore ?? 0;

    let pool = this.file.entries;
    if (opts.layer) pool = pool.filter((e) => e.layer === opts.layer);
    if (opts.scope) pool = pool.filter((e) => e.scope === opts.scope);

    const hits: SearchHit[] = [];
    for (const e of pool) {
      const title = e.title.toLowerCase();
      const body = e.body.toLowerCase();
      const tags = e.tags.map((t) => t.toLowerCase());
      let s = 0;
      if (title.includes(q) || body.includes(q)) s += 0.5;
      for (const t of terms) {
        if (title.includes(t)) s += 0.2;
        if (tags.some((tag) => tag.includes(t))) s += 0.15;
        if (body.includes(t)) s += 0.1;
      }
      const score = Math.min(1, s);
      if (score >= minScore && score > 0) hits.push({ entry: e, score });
    }
    hits.sort(
      (a, b) =>
        b.score - a.score ||
        b.entry.updatedAt.localeCompare(a.entry.updatedAt),
    );
    return hits.slice(0, limit);
  }

  /** Compiled-page read helper: single canonical slug per page. */
  async getCompiledPage(slug: string): Promise<MemoryEntry | undefined> {
    await this.ensureLoaded();
    return this.file.entries.find(
      (e) => e.layer === "compiled" && e.scope === slug,
    );
  }

  /** Store stats — surfaced by personalization_snapshot. */
  async stats(): Promise<{
    total: number;
    byLayer: Record<MemoryLayer, number>;
    path: string;
    bytesOnDisk: number;
  }> {
    await this.ensureLoaded();
    const byLayer: Record<MemoryLayer, number> = {
      personal: 0,
      role: 0,
      session: 0,
      compiled: 0,
    };
    for (const e of this.file.entries) byLayer[e.layer]++;
    let bytesOnDisk = 0;
    try {
      bytesOnDisk = (await fs.stat(this.path)).size;
    } catch { /* never been saved yet */ }
    return { total: this.file.entries.length, byLayer, path: this.path, bytesOnDisk };
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function deriveId(layer: MemoryLayer, scope: string, title: string): string {
  return `${layer}:${scope}:${slugify(title)}`;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9一-鿿]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "untitled"
  );
}

function clampBody(body: string): string {
  if (Buffer.byteLength(body, "utf8") <= MAX_BODY_BYTES) return body;
  // Safe substring on utf8 boundary — truncate then cut back to a clean point.
  const buf = Buffer.from(body, "utf8").subarray(0, MAX_BODY_BYTES);
  return buf.toString("utf8");
}

/** Singleton used by tools/memory.ts. Tests can construct their own. */
export const defaultMemoryStore = new MemoryStore();
