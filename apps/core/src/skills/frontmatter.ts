/**
 * Parse the frontmatter subset used by Seris skills. Parsing is delegated to
 * the `yaml` package; this module only defines the schema, splits the fence,
 * and validates required fields.
 */

import { parse } from 'yaml';

export interface SerisSkillMetadata {
  /** Lower number = surfaced earlier in the system-prompt catalog. */
  priority?: number;
  /** Tool names this skill owns; used by the agent loop to enable modes. */
  tool_names?: string[];
  /** Additional skill metadata is preserved for callers. */
  [key: string]: unknown;
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  metadata?: {
    seris?: SerisSkillMetadata;
    [namespace: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ParsedSkillDoc {
  frontmatter: SkillFrontmatter;
  /** Markdown content after the closing `---`, trimmed. */
  body: string;
}

/**
 * Split a SKILL.md into `{ frontmatter, body }`.
 * Accepts content with or without the leading `---` fence; if no frontmatter
 * fence is present, frontmatter is `{}` and the whole text is the body.
 */
export function parseSkillMarkdown(content: string): ParsedSkillDoc {
  const normalized = content.replace(/^﻿/, ""); // strip BOM
  const fenceMatch = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(normalized);
  if (!fenceMatch) {
    return { frontmatter: {} as SkillFrontmatter, body: normalized.trim() };
  }
  const data = parse(fenceMatch[1]) as SkillFrontmatter;
  const body = normalized.slice(fenceMatch[0].length).trim();
  return { frontmatter: data ?? ({} as SkillFrontmatter), body };
}

/** Validate required skill fields; returns a list of problems ("" = ok). */
export function validateFrontmatter(fm: SkillFrontmatter): string[] {
  const problems: string[] = [];
  if (typeof fm.name !== "string" || fm.name.trim() === "") {
    problems.push("missing or invalid `name`");
  }
  if (typeof fm.description !== "string" || fm.description.trim() === "") {
    problems.push("missing or invalid `description`");
  }
  const seris = fm.metadata?.seris;
  if (seris !== undefined) {
    if (typeof seris !== "object" || seris === null) {
      problems.push("`metadata.seris` must be an object");
    } else {
      if (seris.priority !== undefined && typeof seris.priority !== "number") {
        problems.push("`metadata.seris.priority` must be a number");
      }
      if (
        seris.tool_names !== undefined &&
        !(Array.isArray(seris.tool_names) && seris.tool_names.every((t) => typeof t === "string"))
      ) {
        problems.push("`metadata.seris.tool_names` must be a string array");
      }
    }
  }
  return problems;
}
