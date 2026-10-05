/** Browser-safe wire contract shared by the gateway and desktop UI. */
import { isMarketAction, isMarketContext, parseContextInput, type MarketContext, type MarketContextInput, type MarketAction } from './markets/types.js';
// v4 adds multiple model connections and model selection.
export const PROTOCOL_VERSION = 4;
export type RunStatus = 'running' | 'awaiting-approval' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface RunRecord {
  id: string; sessionId: string; status: RunStatus; startedAt: number; endedAt?: number; error?: string;
  model?: { provider: string; modelId: string; name: string };
}
export interface HistoryEntry {
  id: string; role: 'user' | 'assistant' | 'tool'; text: string;
  toolCallId?: string; toolName?: string; pending?: boolean; isError?: boolean;
  marketContext?: MarketContext; marketAction?: MarketAction;
}
export interface SessionMeta { id: string; name: string; createdAt: number; modifiedAt: number }
export interface ApprovalRequest {
  id: string; sessionId: string; runId: string; toolCallId: string; toolName: string; args: unknown;
}
export interface ChatEvent {
  type: 'run-start' | 'text-delta' | 'message' | 'tool-start' | 'tool-end' | 'turn-end' | 'run-end' | 'approval' | 'session-updated';
  sessionId: string; runId: string; messageId?: string; delta?: string;
  session?: SessionMeta; model?: RunRecord['model'];
  message?: HistoryEntry; toolCallId?: string; toolName?: string; args?: unknown;
  isError?: boolean; error?: string; status?: RunStatus; approval?: ApprovalRequest;
}
export interface Cursor { epoch: string; seq: number }
export interface SessionSnapshot extends Cursor {
  messages: HistoryEntry[]; run: RunRecord | null; approvals: ApprovalRequest[];
}
export type ProviderKind =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'openrouter'
  | 'deepseek'
  | 'moonshotai'
  | 'moonshotai-cn'
  | 'kimi-coding'
  | 'openai-compatible'
  | 'anthropic-compatible'
  | 'ollama'
  | 'lmstudio'
  | 'local';
export type ModelApi =
  | 'anthropic-messages'
  | 'openai-completions'
  | 'openai-responses';
export interface ModelConnection {
  id: string;
  name: string;
  provider: ProviderKind;
  baseUrl: string;
  modelId: string;
  api?: ModelApi;
  requiresKey: boolean;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  models?: ModelOption[];
}
export type ModelConnectionInput = Omit<ModelConnection, 'id'> & {
  id?: string;
  apiKey?: string;
};
export interface ConnectionStatus extends ModelConnection {
  configured: boolean;
  testedAt?: number;
  testedModelId?: string;
}
export interface ModelSelection {
  connectionId: string;
  modelId: string;
}
export interface ModelConfig {
  connections: ConnectionStatus[];
  selected: ModelSelection | null;
  configured: boolean;
  credentialStorage: 'keychain' | 'memory';
  credentialError?: boolean;
}
export interface ModelOption {
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  toolUse?: boolean;
}
export interface ModelDiscovery { models: ModelOption[] }
export interface LocalModelService extends ModelDiscovery {
  provider: 'ollama' | 'lmstudio';
  baseUrl: string;
  status: 'ready' | 'empty' | 'unavailable' | 'unauthorized';
}
export interface ProviderInfo {
  id: ProviderKind;
  name: string;
  baseUrl: string;
  defaultModelId: string;
  requiresKey: boolean;
  models: ModelOption[];
}
export interface StreamControl extends Cursor { type: 'stream-ready' | 'resync-required' }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown): v is string => typeof v === 'string';
export function isCursor(v: unknown): v is Cursor {
  return record(v) && string(v.epoch) && Number.isSafeInteger(v.seq) && Number(v.seq) >= 0;
}
export function isChatEvent(v: unknown): v is ChatEvent {
  if (!record(v) || !string(v.sessionId) || !string(v.runId)) return false;
  switch (v.type) {
    case 'session-updated': return record(v.session) && v.session.id === v.sessionId && string(v.session.name) && Number.isFinite(v.session.createdAt) && Number.isFinite(v.session.modifiedAt);
    case 'text-delta': return string(v.delta) && string(v.messageId);
    case 'message': return isHistoryEntry(v.message);
    case 'tool-start': return string(v.toolCallId) && string(v.toolName);
    case 'tool-end': return string(v.toolCallId) && string(v.toolName) && typeof v.isError === 'boolean';
    case 'approval': return isApproval(v.approval);
    case 'run-start': case 'turn-end': return true;
    case 'run-end': return ['completed', 'failed', 'cancelled', 'interrupted'].includes(String(v.status));
    default: return false;
  }
}
export function isHistoryEntry(v: unknown): v is HistoryEntry {
  return record(v) && string(v.id) && ['user', 'assistant', 'tool'].includes(String(v.role)) && string(v.text)
    && (v.marketContext===undefined||isMarketContext(v.marketContext)) && (v.marketAction===undefined||isMarketAction(v.marketAction));
}
export function isApproval(v: unknown): v is ApprovalRequest {
  return record(v) && ['id', 'sessionId', 'runId', 'toolCallId', 'toolName'].every(k => string(v[k]));
}
export function isSnapshot(v: unknown): v is SessionSnapshot {
  return isCursor(v) && record(v) && Array.isArray(v.messages) && v.messages.every(isHistoryEntry)
    && Array.isArray(v.approvals) && v.approvals.every(isApproval)
    && (v.run === null || isRunRecord(v.run));
}
export function parsePrompt(v: unknown): { text: string; requestId: string; marketContext?: MarketContextInput } {
  if (!record(v) || !string(v.text) || !v.text.trim() || v.text.length > 200_000
      || !string(v.requestId) || !/^[a-zA-Z0-9_-]{8,80}$/.test(v.requestId)) {
    throw new Error('prompt requires text and a valid requestId');
  }
  return { text: v.text, requestId: v.requestId, ...(v.marketContext===undefined?{}:{marketContext:parseContextInput(v.marketContext)}) };
}

export function isRunRecord(v:unknown):v is RunRecord {
  return record(v) && string(v.id) && string(v.sessionId) && Number.isFinite(v.startedAt)
    && ['running','awaiting-approval','cancelling','completed','failed','cancelled','interrupted'].includes(String(v.status));
}
export function isModelConfig(v: unknown): v is ModelConfig {
  return (
    record(v) &&
    typeof v.configured === 'boolean' &&
    ['keychain', 'memory'].includes(String(v.credentialStorage)) &&
    Array.isArray(v.connections) &&
    v.connections.every(
      (c) =>
        record(c) &&
        ['id', 'name', 'provider', 'baseUrl', 'modelId'].every((k) =>
          string(c[k]),
        ) &&
        typeof c.configured === 'boolean' &&
        typeof c.requiresKey === 'boolean' &&
        (c.models === undefined ||
          (Array.isArray(c.models) && c.models.length > 0 && c.models.every(isModelOption))),
    ) &&
    (v.selected === null ||
      (record(v.selected) &&
        string(v.selected.connectionId) &&
        string(v.selected.modelId)))
  );
}
function isModelOption(v: unknown): v is ModelOption {
  return record(v) && string(v.id) && string(v.name) &&
    ['contextWindow', 'maxTokens'].every(k => v[k] === undefined || (Number.isSafeInteger(v[k]) && Number(v[k]) > 0)) &&
    ['reasoning', 'toolUse'].every(k => v[k] === undefined || typeof v[k] === 'boolean');
}

/** The empty-chat placeholder is replaced after the first prompt. */
export function isUntitledSessionName(name: string): boolean {
  return !name || name === 'New chat';
}
export function sessionTitleFallback(text: string): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  return chars.slice(0, 48).join('') + (chars.length > 48 ? '…' : '');
}
