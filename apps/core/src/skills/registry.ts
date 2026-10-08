/**
 * Discover skills from bundled and user directories. Catalog entries keep
 * the system prompt small; load_skill reads the full instructions on demand.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import {
  parseSkillMarkdown,
  validateFrontmatter,
  type SerisSkillMetadata,
} from './frontmatter.js';

export interface SkillSummary {
  name: string;
  description: string;
  priority: number;
  toolNames: string[];
  /** Skill directory name under the skills root. */
  dir: string;
  /** Problems from validateFrontmatter ("" = valid). */
  problems: string[];
}

export interface LoadedSkill extends SkillSummary {
  /** Full markdown body after the frontmatter fence. */
  body: string;
}

const DEFAULT_PRIORITY = 50;

/** Read one skill dir's SKILL.md frontmatter, returning a summary. */
async function readSummary(dir: string, dirPath: string): Promise<SkillSummary | null> {
  const skillPath = join(dirPath, 'SKILL.md');
  let raw: string;
  try {
    raw = await readFile(skillPath, 'utf8');
  } catch {
    return null; // no SKILL.md in this dir
  }
  const { frontmatter } = parseSkillMarkdown(raw);
  const problems = validateFrontmatter(frontmatter);
  const seris: SerisSkillMetadata = frontmatter.metadata?.seris ?? {};
  return {
    name: frontmatter.name ?? dir,
    description: frontmatter.description ?? '',
    priority: typeof seris.priority === 'number' ? seris.priority : DEFAULT_PRIORITY,
    toolNames: Array.isArray(seris.tool_names)
      ? seris.tool_names.filter((t): t is string => typeof t === 'string')
      : [],
    dir: dirPath,
    problems,
  };
}

/**
 * Scan a skills root: every immediate subdirectory with a SKILL.md becomes a
 * SkillSummary (frontmatter parsed, body not included in the catalog). Sorted by priority asc so
 * the system-prompt catalog surfaces the most important skills first.
 */
export async function scanSkillsDir(skillsRoot: string): Promise<SkillSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(skillsRoot);
  } catch {
    return []; // skills dir absent => empty catalog
  }
  const summaries: SkillSummary[] = [];
  for (const dir of entries) {
    const dirPath = join(skillsRoot, dir);
    let st;
    try {
      st = await stat(dirPath);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    // Both 'installed' (user-installed) and 'concepts'/'strategies' (our
    // categorized namespaces) hold sub-directories with their own SKILL.md files.
    if (dir === 'installed' || dir === 'concepts' || dir === 'strategies') {
      summaries.push(...await scanSkillsDir(dirPath));
      continue;
    }
    const summary = await readSummary(dir, dirPath);
    if (summary) summaries.push(summary);
  }
  summaries.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  return summaries;
}

/** Load a skill's full markdown body (only on dispatch). */
export async function loadSkillBody(skillsRoot: string, dir: string): Promise<string> {
  const raw = await readFile(join(isAbsolute(dir) ? dir : join(skillsRoot, dir), 'SKILL.md'), 'utf8');
  return parseSkillMarkdown(raw).body;
}

/** In-memory skill registry: catalog + dispatch-time instruction loading. */
export class SkillRegistry {
  private byName = new Map<string, SkillSummary>();
  private skillsRoot: string;

  private constructor(skillsRoot: string, summaries: SkillSummary[]) {
    this.skillsRoot = skillsRoot;
    for (const s of summaries) this.byName.set(s.name, s);
  }

  static async load(skillsRoot: string, extraRoots: string[] = []): Promise<SkillRegistry> {
    const registry = new SkillRegistry(skillsRoot, []);
    await registry.reload(extraRoots);
    return registry;
  }
  async reload(extraRoots: string[] = []): Promise<void> {
    const summaries = (await Promise.all([this.skillsRoot, ...extraRoots].map(scanSkillsDir))).flat();
    this.byName.clear();
    for (const summary of summaries) this.byName.set(summary.name, summary);
  }

  /** The lean catalog injected into the system prompt (name + description). */
  catalog(): Array<{ name: string; description: string; priority: number; toolNames: string[] }> {
    return [...this.byName.values()].map((s) => ({
      name: s.name,
      description: s.description,
      priority: s.priority,
      toolNames: s.toolNames,
    }));
  }

  /** Union of tool_names across the given skills, de-duplicated, order-stable. */
  toolNamesFor(skillNames: string[]): { toolNames: string[]; unknownSkills: string[] } {
    const out: string[] = [];
    const seen = new Set<string>();
    const unknownSkills: string[] = [];
    for (const name of skillNames) {
      const s = this.byName.get(name);
      if (!s) {
        unknownSkills.push(name);
        continue;
      }
      for (const t of s.toolNames) {
        if (!seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
      }
    }
    return { toolNames: out, unknownSkills };
  }

  /** Legacy advisory tool references; these never activate tools. */
  allToolNames(): string[] {
    const seen = new Set<string>();
    for (const s of this.byName.values()) for (const t of s.toolNames) seen.add(t);
    return [...seen];
  }

  /** Full skill (summary + body) for dispatch; null when unknown. */
  async dispatch(name: string): Promise<LoadedSkill | null> {
    const s = this.byName.get(name);
    if (!s) return null;
    const body = await loadSkillBody(this.skillsRoot, s.dir).catch(() => '');
    return { ...s, body };
  }

  get size(): number {
    return this.byName.size;
  }
}
