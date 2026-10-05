import { randomUUID } from 'node:crypto';
import type { ApprovalRequest } from '../protocol.js';

/** Decisions are accepted only by the authenticated UI API. */
export class Approvals {
  private pending = new Map<string, { request: ApprovalRequest; resolve(allowed: boolean): void }>();
  list(sessionId?: string): ApprovalRequest[] {
    return [...this.pending.values()].map(p => p.request).filter(p => !sessionId || p.sessionId === sessionId);
  }
  async request(input: Omit<ApprovalRequest, 'id'>, signal: AbortSignal, notify: (request: ApprovalRequest) => void): Promise<boolean> {
    signal.throwIfAborted();
    const request = { ...input, id: randomUUID() };
    return new Promise<boolean>(resolve => {
      const finish = (allowed: boolean) => {
        signal.removeEventListener('abort', cancel); clearTimeout(timer);
        this.pending.delete(request.id); resolve(allowed);
      };
      const cancel = () => finish(false);
      const timer = setTimeout(cancel, 10 * 60_000);
      this.pending.set(request.id, { request, resolve: finish });
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel(); else { try { notify(request); } catch (error) { cancel(); throw error; } }
    });
  }
  decide(id: string, runId: string, allowed: boolean): void {
    const p = this.pending.get(id);
    if (!p || p.request.runId !== runId) throw new Error('Approval expired or belongs to another run');
    p.resolve(allowed);
  }
}
const GATED = new Set([
  'terminal', 'execute_code', 'computer', 'browser_click', 'browser_type', 'browser_navigate', 'browser_back',
  'brokerage_order_submit', 'brokerage_order_cancel', 'seris_wallet_fund_perp', 'seris_wallet_withdraw_to_spot', 'install_skill', 'uninstall_skill',
]);
export function requiresApproval(name: string): boolean { return GATED.has(name); }
