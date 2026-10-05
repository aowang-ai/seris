/**
 * Parse the frontmatter subset used by Seris skills: strings, numbers,
 * arrays and nested metadata. Validate required name/description fields
 * and optional metadata.seris priority and tool names.
 */

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

type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue };

/** Unquote a scalar and coerce to number/boolean/null when appropriate. */
function parseScalar(raw: string): YamlValue {
  const s = raw.trim();
  if (s === "") return "";
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    return s.slice(1, -1);
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

/** Parse an inline flow sequence: `[a, b, "c, d"]`. */
function parseInlineList(s: string): YamlValue[] {
  const inner = s.slice(1, -1).trim();
  if (inner === "") return [];
  const items: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (const ch of inner) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === "[") {
      depth++;
      cur += ch;
    } else if (ch === "]") {
      depth--;
      cur += ch;
    } else if (ch === "," && depth === 0) {
      items.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== "") items.push(cur);
  return items.map((it) => parseScalar(it));
}

interface Frame {
  indent: number; // indent width (spaces) at which this container's keys/entries live
  container: Record<string, YamlValue> | YamlValue[];
}

/**
 * Parse a YAML subset into a plain object. Throws on obviously malformed input;
 * tolerant of blank lines and `#` full-line comments.
 */
export function parseSimpleYaml(yamlText: string): Record<string, YamlValue> {
  const lines = yamlText.split(/\r?\n/);
  const root: Record<string, YamlValue> = {};
  const stack: Frame[] = [{ indent: -1, container: root }];

  const top = () => stack[stack.length - 1];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine.trim() === "" || rawLine.trim().startsWith("#")) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    // Pop frames whose content has ended (dedent).
    while (stack.length > 1 && indent <= top().indent) stack.pop();

    // Block-list entry under an existing `key:` that opened a list.
    if (line.startsWith("- ")) {
      const frame = top();
      if (!Array.isArray(frame.container)) {
        throw new Error("frontmatter: list item without an open list");
      }
      frame.container.push(parseScalar(line.slice(2)));
      continue;
    }

    const m = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) throw new Error(`frontmatter: cannot parse line: ${rawLine}`);
    const key = m[1];
    const rest = m[2];
    const frame = top();
    if (Array.isArray(frame.container)) {
      throw new Error(`frontmatter: map key inside a list: ${key}`);
    }
    const container = frame.container;

    if (rest === "") {
      // Look ahead: block list (`  - a`) or block map (`  child: v`)?
      // We decide lazily by peeking at the next meaningful line.
      let next: string | null = null;
      for (let j = i + 1; j < lines.length; j++) {
        const t = lines[j].trim();
        if (t !== "" && !t.startsWith("#")) {
          next = t;
          break;
        }
      }
      if (next !== null && next.startsWith("- ")) {
        const arr: YamlValue[] = [];
        container[key] = arr;
        stack.push({ indent, container: arr });
      } else {
        const obj: Record<string, YamlValue> = {};
        container[key] = obj;
        stack.push({ indent, container: obj });
      }
    } else if (rest.startsWith("[")) {
      container[key] = parseInlineList(rest);
    } else {
      container[key] = parseScalar(rest);
    }
  }

  return root;
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
  const data = parseSimpleYaml(fenceMatch[1]);
  const body = normalized.slice(fenceMatch[0].length).trim();
  return { frontmatter: data as SkillFrontmatter, body };
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
