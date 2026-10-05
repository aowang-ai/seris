/**
 * Store selected local conversations as examples for evaluation and
 * prompt improvement. Harvested records stay in the user data directory.
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { dataPath } from '../runtime/paths.js';

export interface FewShotExemplar {
  id: string;
  /** The user's query that produced this exemplar. */
  query: string;
  /** Compact trace: tool names in call order + the final answer summary. */
  toolChain: string[];
  /** The (truncated) final assistant answer. */
  answer: string;
  /** Why this run is worth learning from (e.g. 'multi-tool-success'). */
  reason: string;
  createdAt: number;
  /** Times this exemplar has been retrieved & injected. */
  uses: number;
}

interface Store { exemplars: Record<string, FewShotExemplar>; }

const CAP = 200;
const ANSWER_CAP = 600;

export class FewShotStore {
  private store: Store = { exemplars: {} };
  private readonly path: string;
  constructor(path?: string) {
    this.path = resolve(path ?? dataPath('fewshot.json'));
    this.load();
  }
  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Store;
      if (parsed && parsed.exemplars) this.store = { exemplars: parsed.exemplars };
    } catch { this.store = { exemplars: {} }; }
  }
  private persist(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = this.path + '.tmp-' + process.pid;
      writeFileSync(tmp, JSON.stringify(this.store, null, 2), 'utf8');
      renameSync(tmp, this.path);
    } catch (e) { throw new Error(`Unable to persist learned examples: ${e}`); }
  }
  private seq = 0;
  private newId(): string { return 'fs_' + Date.now().toString(36) + '_' + (++this.seq).toString(36); }

  /** Should this run be harvested? Multi-tool use + a non-trivial final answer. */
  static isWorthLearning(toolChain: string[], answer: string): { worth: boolean; reason: string } {
    const uniqueTools = new Set(toolChain);
    if (toolChain.length >= 2) return { worth: true, reason: 'multi-tool-chain' };
    if (uniqueTools.size >= 1 && answer.length > 200) return { worth: true, reason: 'rich-single-tool' };
    return { worth: false, reason: '' };
  }

  /** Capture a successful run as an exemplar. */
  harvest(query: string, toolChain: string[], answer: string, reason: string): FewShotExemplar {
    const ex: FewShotExemplar = {
      id: this.newId(), query, toolChain, reason,
      answer: answer.slice(0, ANSWER_CAP),
      createdAt: Date.now(), uses: 0,
    };
    this.store.exemplars[ex.id] = ex;
    const ids = Object.keys(this.store.exemplars);
    if (ids.length > CAP) {
      const sorted = ids.map((id) => this.store.exemplars[id]).sort((a, b) => (b.uses - a.uses) || (b.createdAt - a.createdAt));
      const keep = new Set(sorted.slice(0, CAP).map((e) => e.id));
      for (const id of ids) if (!keep.has(id)) delete this.store.exemplars[id];
    }
    this.persist();
    return ex;
  }

  /** Lexical-overlap scorer (simple, fast, no embeddings needed). */
  private score(query: string, ex: FewShotExemplar): number {
    const tok = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
    const q = tok(query);
    const e = tok(ex.query + ' ' + ex.toolChain.join(' '));
    let overlap = 0;
    for (const w of q) if (e.has(w)) overlap++;
    return overlap + ex.uses * 0.1;
  }

  /** Retrieve the top-K most relevant exemplars for a new query. */
  retrieve(query: string, k = 3): FewShotExemplar[] {
    return Object.values(this.store.exemplars)
      .map((e) => ({ e, s: this.score(query, e) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map((x) => x.e);
  }

  /** Render exemplars as a system-prompt block (compact). */
  renderForPrompt(exemplars: FewShotExemplar[]): string {
    if (exemplars.length === 0) return '';
    const lines = ['<learned-examples>', 'You have done similar tasks before. Reuse these proven approaches:'];
    for (const ex of exemplars) {
      ex.uses++; this.persist();
      lines.push('- Q: ' + ex.query);
      lines.push('  Tools: ' + ex.toolChain.join(' → '));
      lines.push('  A: ' + ex.answer.replace(/\n+/g, ' ').slice(0, 220));
    }
    lines.push('</learned-examples>');
    return lines.join('\n');
  }

  count(): number { return Object.keys(this.store.exemplars).length; }
  list(): FewShotExemplar[] { return Object.values(this.store.exemplars).sort((a, b) => b.createdAt - a.createdAt); }
}

let singleton: FewShotStore | null = null;
let singletonPath = '';
export function getFewShotStore(path?: string): FewShotStore {
  const target = path ?? dataPath('fewshot.json');
  if (!singleton || singletonPath !== target) { singleton = new FewShotStore(target); singletonPath = target; }
  return singleton;
}
