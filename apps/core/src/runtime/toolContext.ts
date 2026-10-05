import { AsyncLocalStorage } from 'node:async_hooks';
import type { MarketContext } from '../markets/types.js';
export interface ToolExecutionContext { sessionId: string; runId?: string; workspace: string; signal?: AbortSignal; marketContext?: MarketContext }
export const toolContext = new AsyncLocalStorage<ToolExecutionContext>();
export function toolSignal(timeoutMs: number, signal?: AbortSignal | null): AbortSignal {
  const signals = [AbortSignal.timeout(timeoutMs), signal, toolContext.getStore()?.signal].filter((s): s is AbortSignal => !!s);
  return AbortSignal.any(signals);
}
