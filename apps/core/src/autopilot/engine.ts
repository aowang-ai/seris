/**
 * autopilot/engine.ts — real autonomous strategy scheduler.
 *
 * An autopilot strategy is a recurring agent-driven run: every `intervalMs`
 * (or on a cron-style schedule) the engine invokes a runner LLM-free step
 * chain: observe (gather real market/wallet data via registered tools) →
 * analyze (decide whether the strategy's trigger conditions are met) →
 * act (notify always; dangerous fund-moving steps go through the proactive
 * approval gate, never auto-execute).
 *
 * State persists to .data/autopilot.json so strategies survive restarts.
 * The engine is safe-by-default: nothing that moves funds runs without an
 * explicit human approval recorded in the proactive store.
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { dataPath } from '../runtime/paths.js';
import { getMarketService } from '../markets/service.js';
import { parseRule } from '../markets/types.js';

export type AutopilotStatus = 'active' | 'paused' | 'closed';

export interface AutopilotRun {
  runAt: number;
  ok: boolean;
  summary: string;
  /** observed data snapshot the analyzer saw */
  observed?: Record<string, unknown>;
  /** notifications produced this run */
  notified?: string[];
  error?: string;
}

export interface AutopilotStrategy {
  id: string;
  name: string;
  /** What the strategy does, NL. */
  description: string;
  kind: 'dca' | 'alert' | 'rebalance' | 'funding-monitor' | 'custom';
  status: AutopilotStatus;
  /** Recurrence: every N ms. */
  intervalMs: number;
  /** Symbol / market the strategy watches. */
  symbol?: string;
  /** Strategy-specific params (thresholds, amounts, channels). */
  params: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  runCount: number;
  /** Rolling history, newest first, capped. */
  history: AutopilotRun[];
}

interface AutopilotStore {
  strategies: Record<string, AutopilotStrategy>;
}

const HISTORY_CAP = 50;

export type ObserveFn = (s: AutopilotStrategy) => Promise<Record<string, unknown>>;
export type AnalyzeFn = (
  s: AutopilotStrategy,
  observed: Record<string, unknown>,
) => Promise<{ shouldNotify: boolean; summary: string; notifications: string[] }>;

export interface AutopilotEngineOptions {
  statePath?: string;
  observe?: ObserveFn;
  analyze?: AnalyzeFn;
  /** min ms between runs of the same strategy (safety floor). */
  minIntervalMs?: number;
}

export class AutopilotEngine {
  private store: AutopilotStore = { strategies: {} };
  private readonly statePath: string;
  private readonly observe: ObserveFn;
  private readonly analyze: AnalyzeFn;
  private readonly minInterval: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private revisions = new Map<string,number>();
  private inFlight = new Map<string, Promise<AutopilotRun | undefined>>();
  private readonly tickMs = 1000;

  constructor(opts: AutopilotEngineOptions = {}) {
    this.statePath = resolve(opts.statePath ?? dataPath('autopilot.json'));
    this.observe = opts.observe ?? defaultObserve;
    this.analyze = opts.analyze ?? defaultAnalyze;
    this.minInterval = opts.minIntervalMs ?? 5000;
    this.load();
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.statePath, 'utf8')) as AutopilotStore;
      if (parsed && typeof parsed === 'object') this.store = { strategies: parsed.strategies ?? {} };
    } catch {
      this.store = { strategies: {} };
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.statePath), { recursive: true });
      const tmp = `${this.statePath}.tmp-${process.pid}`;
      writeFileSync(tmp, JSON.stringify(this.store, null, 2), 'utf8');
      renameSync(tmp, this.statePath);
    } catch (e) { throw new Error(`Unable to save autopilot state: ${e}`); }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const s of Object.values(this.store.strategies)) {
      if (s.status !== 'active') continue;
      const due = !s.lastRunAt || now - s.lastRunAt >= Math.max(s.intervalMs, this.minInterval);
      if (due) await this.runStrategy(s.id).catch(() => undefined);
    }
  }

  private seq = 0;
  private newId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${(++this.seq).toString(36)}`;
  }

  register(input: Omit<AutopilotStrategy, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'history' | 'status'> & { id?: string }): AutopilotStrategy {
    const now = Date.now();
    const strategy: AutopilotStrategy = {
      ...input,
      id: input.id ?? this.newId('ap'),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      runCount: 0,
      history: [],
    };
    this.store.strategies[strategy.id] = strategy;
    this.persist();
    return strategy;
  }

  get(id: string): AutopilotStrategy | undefined {
    const s = this.store.strategies[id];
    return s ? structuredClone(s) : undefined;
  }

  list(): AutopilotStrategy[] {
    return Object.values(this.store.strategies)
      .map((s) => structuredClone(s))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  setStatus(id: string, status: AutopilotStatus): AutopilotStrategy | undefined {
    const s = this.store.strategies[id];
    if (!s) return undefined;
    this.revisions.set(id,(this.revisions.get(id)??0)+1);
    s.status = status;
    s.updatedAt = Date.now();
    this.persist();
    return structuredClone(s);
  }

  runStrategy(id: string): Promise<AutopilotRun | undefined> {
    const pending=this.inFlight.get(id); if(pending)return pending;
    const run=this.runOnce(id).finally(()=>this.inFlight.delete(id)); this.inFlight.set(id,run); return run;
  }
  private async runOnce(id: string): Promise<AutopilotRun | undefined> {
    const s = this.store.strategies[id];
    if (!s || s.params.marketRule&&s.status!=='active') return undefined;
    const revision=this.revisions.get(id)??0;
    const runAt = Date.now();
    const statusAtStart=s.status;
    let run: AutopilotRun;
    try {
      const observed = await this.observe(s);
      if((this.revisions.get(id)??0)!==revision || s.status!==statusAtStart || s.status==='closed') return undefined;
      const decision = await this.analyze(s, observed);
      if((this.revisions.get(id)??0)!==revision)return undefined;
      run = {
        runAt,
        ok: true,
        summary: decision.summary,
        observed,
        notified: decision.shouldNotify ? decision.notifications : [],
      };
    } catch (e) {
      run = { runAt, ok: false, summary: 'run failed', error: (e as Error).message };
    }
    s.lastRunAt = runAt;
    s.runCount += 1;
    s.updatedAt = Date.now();
    s.history.unshift(run);
    if (s.history.length > HISTORY_CAP) s.history.length = HISTORY_CAP;
    this.persist();
    return structuredClone(run);
  }
}

/* --------------------------- default observe/analyze --------------------------- */

import { fetchJson } from '../tools/registry.js';

/** Default observer: real data via Hyperliquid + CoinGecko, no key. */
const defaultObserve: ObserveFn = async (s) => {
  if (s.params.marketRule) return getMarketService().observeRule(parseRule(s.params.marketRule));
  const out: Record<string, unknown> = { kind: s.kind, symbol: s.symbol };
  if (s.symbol) {
    const hl = await fetchJson('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    });
    if (hl.ok) {
      const [meta, ctxs] = hl.data as [{ universe: Array<{ name: string }> }, Array<Record<string, string>>];
      const idx = meta.universe.findIndex((u) => u.name.toUpperCase() === s.symbol!.toUpperCase());
      if (idx >= 0) {
        const c = ctxs[idx];
        out.markPrice = Number(c.markPx);
        out.fundingRateHourlyPct = Number(c.funding) * 100;
        out.openInterestUsd = Number(c.openInterest) * Number(c.markPx);
        out.volume24hUsd = Number(c.dayNtlVlm);
      }
    }
  }
  return out;
};

/** Default analyzer: threshold rules per strategy kind. */
const defaultAnalyze: AnalyzeFn = async (s, observed) => {
  const p = s.params;
  const notifications: string[] = [];
  let summary = `${s.name}: observed ${s.symbol ?? 'n/a'}`;
  let shouldNotify = false;

  if(p.marketRule){
    const rule=parseRule(p.marketRule),value=observed.metric;
    if(typeof value!=='number')return {shouldNotify:false,summary:String(observed.monitoring??'等待行情'),notifications:[]};
    const meets=(v:number)=>rule.direction==='above'?v>=rule.threshold:v<=rule.threshold;
    const previous=s.history.find(r=>r.ok&&typeof r.observed?.metric==='number')?.observed?.metric;
    shouldNotify=meets(value)&&(typeof previous!=='number'||!meets(previous));
    summary=`${s.name}: ${value}`;
    if(shouldNotify){notifications.push(`${s.name}；观测值 ${value}`);if(rule.once)s.status='paused';}
    return {shouldNotify,summary,notifications};
  }

  if (s.kind === 'funding-monitor' && typeof observed.fundingRateHourlyPct === 'number') {
    const threshold = Number(p.fundingThresholdPct ?? 0.01);
    const funding = observed.fundingRateHourlyPct as number;
    summary = `${s.symbol} funding ${funding.toFixed(4)}%/hr (threshold ${threshold}%)`;
    if (Math.abs(funding) >= threshold) {
      shouldNotify = true;
      notifications.push(`⚠️ ${s.symbol} funding rate ${funding.toFixed(4)}%/hr crossed ±${threshold}% threshold. Annualized ~${(funding * 24 * 365).toFixed(1)}%.`);
    }
  } else if (s.kind === 'alert' && typeof observed.markPrice === 'number') {
    const above = p.priceAbove !== undefined ? Number(p.priceAbove) : null;
    const below = p.priceBelow !== undefined ? Number(p.priceBelow) : null;
    const px = observed.markPrice as number;
    summary = `${s.symbol} mark $${px.toLocaleString()}`;
    if (above !== null && px >= above) {
      shouldNotify = true;
      notifications.push(`🔔 ${s.symbol} crossed above $${above.toLocaleString()} — now $${px.toLocaleString()}.`);
    }
    if (below !== null && px <= below) {
      shouldNotify = true;
      notifications.push(`🔔 ${s.symbol} fell below $${below.toLocaleString()} — now $${px.toLocaleString()}.`);
    }
  } else if (s.kind === 'dca') {
    summary = `${s.name}: DCA tick for ${s.symbol} (amount $${p.amountUsd ?? '?'}). Pending execution approval.`;
    notifications.push(`💰 DCA reminder: scheduled purchase of $${p.amountUsd ?? '?'} ${s.symbol} is due. Awaiting approval to execute.`);
    shouldNotify = true;
  }

  return { shouldNotify, summary, notifications };
};

let singleton: AutopilotEngine | null = null;
let singletonPath = '';
export function getAutopilotEngine(opts?: AutopilotEngineOptions): AutopilotEngine {
  const path = opts?.statePath ?? dataPath('autopilot.json');
  if (!singleton || singletonPath !== path) { singleton?.stop(); singleton = new AutopilotEngine({ ...opts, statePath: path }); singletonPath = path; }
  return singleton;
}
