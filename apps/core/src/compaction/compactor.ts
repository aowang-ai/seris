import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { dataPath } from '../runtime/paths.js';

export const COMPACT_DEFAULT_WINDOW = 160_000;
export const COMPACT_BOUNDARY_UNITS = 'raw' as const;
export const COMPACT_KEEP_RECENT_TURNS_DEFAULT = 8;
export interface BoundaryRecord {
  boundary: number; updatedAt: string; windowTokens: number;
  sourceCount?: number; sourceHash?: string; summary?: string;
}
const boundaryPath = (id: string) => join(dataPath('compaction'), `${id.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);
export async function loadBoundary(id: string): Promise<BoundaryRecord> {
  try { return JSON.parse(await fs.readFile(boundaryPath(id), 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
  return { boundary: 0, updatedAt: new Date(0).toISOString(), windowTokens: COMPACT_DEFAULT_WINDOW };
}
export async function saveBoundary(id: string, record: BoundaryRecord): Promise<void> {
  const file = boundaryPath(id);
  await fs.mkdir(dataPath('compaction'), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(record), { mode: 0o600 });
  await fs.rename(temp, file);
}
function textOf(m: AgentMessage): string {
  const c = (m as { content?: unknown }).content;
  return typeof c === 'string' ? c : JSON.stringify(c ?? '');
}
const hash = (ms: AgentMessage[]) => createHash('sha256').update(JSON.stringify(ms.map(m => ({ role: m.role, content: (m as any).content, toolCallId: (m as any).toolCallId })))).digest('hex');
export type EstimateTokensFn = (ms: AgentMessage[]) => number;
export const estimateTokensDefault: EstimateTokensFn = ms => ms.reduce((sum, m) => {
  const t = textOf(m);
  const wide = (t.match(/[^\x00-\x7f]/g) ?? []).length;
  return sum + Math.ceil((t.length - wide) / 3 + wide) + 8;
}, 0);
export type SummarizeFn = (messages: AgentMessage[], ctx: { sessionId: string; fromIndex: number; toIndex: number }) => Promise<string> | string;
export const heuristicSummarize: SummarizeFn = ms => '[Earlier context, abbreviated]\n' + ms.map(m => `${m.role}: ${textOf(m).slice(0, 280)}`).join('\n');
export interface CompactArgs { sessionId: string; messages: AgentMessage[]; estimateTokens?: EstimateTokensFn; summarizeFn?: SummarizeFn; windowTokens?: number; keepRecentTurns?: number }
export interface CompactResult { compacted: boolean; messages: AgentMessage[]; tokensEstimated: number; boundary: number }

/** The stored boundary indexes the ORIGINAL transcript, not a transient shortened array. */
export async function compactIfNeeded(args: CompactArgs): Promise<CompactResult> {
  const { sessionId, messages, estimateTokens = estimateTokensDefault, summarizeFn = heuristicSummarize,
    windowTokens = COMPACT_DEFAULT_WINDOW, keepRecentTurns = COMPACT_KEEP_RECENT_TURNS_DEFAULT } = args;
  const record = await loadBoundary(sessionId);
  const priorCount = record.sourceCount ?? 0;
  const valid = priorCount > 0 && priorCount <= messages.length && typeof record.summary === 'string' && record.sourceHash === hash(messages.slice(0, priorCount));
  const note = (text: string): AgentMessage => ({ role: 'system', content: text, timestamp: 0 } as AgentMessage);
  let next = valid ? [note(record.summary!), ...messages.slice(priorCount)] : messages;
  if (estimateTokens(next) <= windowTokens) return { compacted: !!valid, messages: next, tokensEstimated: estimateTokens(next), boundary: valid ? priorCount : 0 };

  // Never split an assistant tool-call batch from any of its results.
  const pending = new Set<string>();
  const cuts: number[] = [];
  const protectedStart = Math.max(0, messages.length - keepRecentTurns);
  for (let i = 0; i < protectedStart; i++) {
    const m = messages[i] as any;
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const c of m.content) if (c.type === 'toolCall') pending.add(c.id);
    }
    if (m.role === 'toolResult') pending.delete(m.toolCallId);
    if (pending.size === 0 && (m.role === 'assistant' || m.role === 'toolResult') && i + 1 >= (valid ? priorCount : 0)) cuts.push(i + 1);
  }
  for (const cut of cuts) {
    const tail = messages.slice(cut);
    if (estimateTokens(tail) + 40 >= windowTokens) continue;
    const old = valid ? [note(record.summary!), ...messages.slice(priorCount, cut)] : messages.slice(0, cut);
    let summary = await summarizeFn(old, { sessionId, fromIndex: valid ? priorCount : 0, toIndex: cut });
    next = [note(summary), ...tail];
    // Summary cost is part of the budget, not extra space added afterwards.
    while (estimateTokens(next) > windowTokens && summary.length > 32) {
      summary = summary.slice(0, Math.floor(summary.length * 0.7)) + '\n[abbreviated]';
      next = [note(summary), ...tail];
    }
    if (estimateTokens(next) > windowTokens) continue;
    await saveBoundary(sessionId, { boundary: cut, sourceCount: cut, sourceHash: hash(messages.slice(0, cut)), summary,
      windowTokens, updatedAt: new Date().toISOString() });
    return { compacted: true, messages: next, tokensEstimated: estimateTokens(next), boundary: cut };
  }
  throw new Error('Recent messages exceed the model context budget; shorten the input or start a new session');
}
