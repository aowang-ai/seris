import { readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineTool, type LooseToolDef, type ToolRegistry } from '../tools/registry.js';

/** A small Seris host for pi AgentTool definitions, not the pi CLI ExtensionAPI. */
export interface ExtensionAPI {
  registerTool(tool: LooseToolDef): void;
  onStart(callback: () => void | Promise<void>): void;
  onStop(callback: () => void | Promise<void>): void;
}
export type Extension = (api: ExtensionAPI) => void | Promise<void>;

export async function loadExtensions(registry: ToolRegistry, roots: string[]) {
  const starts: Array<() => void | Promise<void>> = [];
  const stops: Array<() => void | Promise<void>> = [];
  const api: ExtensionAPI = {
    registerTool: tool => {
      if (['tool_search', 'load_skill'].includes(tool.name)) throw new Error(`Reserved tool name: ${tool.name}`);
      if (tool.approval !== undefined && !['ask', 'none'].includes(tool.approval)) throw new Error(`Invalid approval policy: ${tool.name}`);
      registry.register(defineTool({ ...tool, defaultActive: tool.defaultActive ?? false, approval: tool.approval ?? 'ask' }));
    },
    onStart: callback => { starts.push(callback); },
    onStop: callback => { stops.push(callback); },
  };
  for (const root of roots) {
    const entries = await readdir(root, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue; // Includes macOS AppleDouble metadata.
      let file: string | undefined;
      if (entry.isFile() && /\.(m?js)$/.test(entry.name)) file = join(root, entry.name);
      if (entry.isDirectory()) {
        for (const name of ['index.mjs', 'index.js']) {
          const candidate = join(root, entry.name, name);
          if (await access(candidate).then(() => true, () => false)) { file = candidate; break; }
        }
      }
      if (!file) continue;
      const extension = (await import(pathToFileURL(file).href)).default as Extension;
      if (typeof extension !== 'function') throw new Error(`Extension must export a default function: ${file}`);
      await extension(api);
    }
  }
  let started = false;
  let stopped = false;
  return {
    async start() {
      if (started || stopped) return;
      started = true;
      for (const start of starts) await start();
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      const errors: unknown[] = [];
      for (const stop of [...stops].reverse()) {
        try { await stop(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'Unable to close extension services');
    },
  };
}
