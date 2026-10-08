/**
 * tools/registry.ts — central tool catalog, built on pi types.
 *
 * A HarnessTool is a pi AgentTool in pi's exact execute signature. All
 * extensions register tools; each conversation selects its active declarations.
 * Skills supply instructions independently of tool availability.
 *
 * `defineTool` is kept as the single construction point — new tools should be
 * written in pi's signature (toolCallId, params, signal, onUpdate).
 */

import type { ToolCategory, HarnessTool } from '../loop/types.js';
import { toolContext, toolSignal } from '../runtime/toolContext.js';

export type { ToolCategory, HarnessTool };

export class ToolRegistry {
  private tools = new Map<string, HarnessTool>();

  register(tool: HarnessTool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`ToolRegistry: duplicate tool name "${tool.name}"`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  registerAll(tools: HarnessTool[]): this {
    for (const t of tools) this.register(t);
    return this;
  }

  get(name: string): HarnessTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  list(): HarnessTool[] {
    return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  byCategory(category: ToolCategory): HarnessTool[] {
    return this.list().filter((t) => t.category === category);
  }

  toolSetByNames(names: string[]): HarnessTool[] {
    const out: HarnessTool[] = [];
    for (const n of names) {
      const t = this.tools.get(n);
      if (t) out.push(t);
    }
    return out;
  }

  get size(): number {
    return this.tools.size;
  }
}

export async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<
  | { ok: true; data: unknown }
  | { ok: false; error: { error: Record<string, unknown> } }
> {
  const timeoutMs = init.timeoutMs ?? 10_000;
  const signal = toolSignal(timeoutMs, init.signal);
  try {
    const res = await fetch(url, {
      ...init,
      signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'seris/0.1',
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      return {
        ok: false,
        error: {
          error: {
            kind: 'http',
            status: res.status,
            statusText: res.statusText,
            source: url,
          },
        },
      };
    }
    return { ok: true, data: new Headers(init.headers).get('accept') === 'text/plain' ? await res.text() : await res.json() };
  } catch (err) {
    return {
      ok: false,
      error: {
        error: {
          kind: init.signal?.aborted || toolContext.getStore()?.signal?.aborted ? 'cancelled' : signal.aborted ? 'timeout' : 'network',
          message: String((err as Error)?.message ?? err),
          source: url,
        },
      },
    };
  }
}

/**
 * defineTool — wrap a tool definition so execute()'s raw return value is
 * automatically wrapped into pi's AgentToolResult shape. New tools should
 * write `execute(toolCallId, params, signal): Promise<AgentToolResult>`
 * directly; existing tools may return any JSON, and this helper boxes it.
 */
/**
 * Loose input shape: tools declare parameters + an execute that returns any
 * serializable value. defineTool wraps it into pi's AgentToolResult.
 */
export interface LooseToolDef {
  name: string;
  label?: string;
  description: string;
  category: ToolCategory;
  parameters: unknown;
  defaultActive?: boolean;
  approval?: 'ask' | 'none';
  searchTerms?: string;
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: Parameters<HarnessTool['execute']>[3],
  ) => Promise<unknown> | unknown;
}

export function defineTool(def: LooseToolDef): HarnessTool {
  return {
    name: def.name,
    label: def.label ?? def.name.replaceAll('_', ' '),
    description: def.description,
    category: def.category,
    defaultActive: def.defaultActive,
    approval: def.approval ?? 'none',
    searchTerms: def.searchTerms,
    parameters: def.parameters as never,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const activeSignal=signal ?? toolContext.getStore()?.signal;
      activeSignal?.throwIfAborted();
      const raw = await def.execute(toolCallId, params, activeSignal, onUpdate);
      if (raw && typeof raw === 'object' && Array.isArray((raw as { content?: unknown }).content)) {
        return raw as never;
      }
      return {
        content: [{ type: 'text', text: typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2) }],
        details: raw,
      };
    },
  } as HarnessTool;
}
