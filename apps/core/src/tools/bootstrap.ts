/** bootstrapTools — runtime skill self-installation.
 * The agent can search a registry, install a new skill into the user-
 * writable skills dir, and hot-reload it into the live skill catalog.
 */

import { defineTool, type HarnessTool } from './registry.js';
import { getBootstrapRegistry } from '../bootstrap/registry.js';
import { SkillRegistry } from '../skills/registry.js';
import { installedSkillsRoot } from '../runtime/paths.js';

const skillsRoot = installedSkillsRoot;

/** Modules that need to be told to rescan after install (set by runtime). */
let reloadHook: (() => Promise<{ skills: number }>) | null = null;
export function setCapabilitiesReloadHook(hook: () => Promise<{ skills: number }>): void {
  reloadHook = hook;
}

export const searchSkillsTool: HarnessTool = defineTool({
  name: 'search_skills',
  description: 'Search the skill registry for installable skills matching a query (e.g. "stock analysis", "defi"). Returns name, description, source, and the tools each skill would add.',
  category: 'skills',
  parameters: { type: 'object', properties: { query: { type: 'string', description: 'Free-text query.' } }, required: ['query'] },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const registry = getBootstrapRegistry(skillsRoot());
    const results = await registry.search(args.query);
    return { real: true, query: args.query, count: results.length, skills: results };
  },
});

export const installSkillTool: HarnessTool = defineTool({
  name: 'install_skill',
  description: 'Install a skill from the registry into the user-writable skills dir (skills/installed/<name>/). The skill becomes available after reload_capabilities. Source can be a registry name (from search_skills) — runs offline against the bundled index.',
  category: 'skills',
  parameters: { type: 'object', properties: { source: { type: 'string', description: 'Registry source: skill name (e.g. "defi-yield") or "owner/repo" for GitHub.' } }, required: ['source'] },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const registry = getBootstrapRegistry(skillsRoot());
    const result = await registry.install(args.source);
    if (!result.installed) return { real: true, installed: false, error: result.error };
    return { real: true, installed: true, name: result.name, dir: result.dir, note: 'Call reload_capabilities to activate.' };
  },
});

export const reloadCapabilitiesTool: HarnessTool = defineTool({
  name: 'reload_capabilities',
  description: 'Rescan the skills root so newly-installed skills immediately appear in the system-prompt skill catalog. Run after install_skill.',
  category: 'skills',
  parameters: { type: 'object', properties: {} },
  async execute() {
    if (reloadHook) {
      const res = await reloadHook();
      return { real: true, reloaded: true, skills: res.skills };
    }
    const skills = await SkillRegistry.load(skillsRoot());
    return { real: true, reloaded: true, skills: skills.size, note: 'fresh registry loaded (no live hook set)' };
  },
});

export const uninstallSkillTool: HarnessTool = defineTool({
  name: 'uninstall_skill',
  description: 'Remove an installed skill (from skills/installed/<name>/).',
  category: 'skills',
  parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const registry = getBootstrapRegistry(skillsRoot());
    const removed = await registry.uninstall(args.name);
    return { real: true, removed, note: removed ? 'Call reload_capabilities.' : 'Not found.' };
  },
});

export const listInstalledSkillsTool: HarnessTool = defineTool({
  name: 'list_installed_skills',
  description: 'List skills installed into the user-writable dir with their install provenance.',
  category: 'skills',
  parameters: { type: 'object', properties: {} },
  async execute() {
    const registry = getBootstrapRegistry(skillsRoot());
    return { real: true, installed: await registry.listInstalled() };
  },
});

export const bootstrapTools: HarnessTool[] = [
  searchSkillsTool, installSkillTool, reloadCapabilitiesTool,
  uninstallSkillTool, listInstalledSkillsTool,
];
