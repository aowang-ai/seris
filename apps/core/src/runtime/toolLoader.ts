import { fileURLToPath } from 'node:url';
import { ToolRegistry } from '../tools/registry.js';
import { loadExtensions } from '../extensions/loader.js';

export const bundledExtensionsRoot = fileURLToPath(new URL('../extensions/builtin/', import.meta.url));

/** Shared by the app and catalog checks. Services start only at app startup. */
export async function buildRegistry(): Promise<ToolRegistry> {
  const tools = new ToolRegistry();
  await loadExtensions(tools, [bundledExtensionsRoot]);
  return tools;
}
