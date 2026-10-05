/**
 * autopilotTools — expose the AutopilotEngine as model-callable tools.
 *
 * Real behavior: registering starts a live scheduler that re-runs the
 * strategy on its interval against REAL data (Hyperliquid / CoinGecko).
 * Notifications accumulate in the strategy history; dangerous actions are
 * never auto-executed (the proactive approval gate handles those).
 */

import { defineTool, type HarnessTool } from './registry.js';
import {
  getAutopilotEngine,
  type AutopilotStrategy,
} from '../autopilot/engine.js';

function ensureStarted() {
  const engine = getAutopilotEngine();
  engine.start();
  return engine;
}

function strategySummary(s: AutopilotStrategy) {
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    status: s.status,
    symbol: s.symbol,
    intervalMs: s.intervalMs,
    runCount: s.runCount,
    lastRunAt: s.lastRunAt,
    params: s.params,
    recentHistory: s.history.slice(0, 5),
  };
}

export const autopilotRegisterTool: HarnessTool = defineTool({
  name: 'autopilot_register',
  description:
    'Register and START a real autonomous strategy. It re-runs on intervalMs against live data (Hyperliquid/CoinGecko). Kinds: alert (price crosses threshold), funding-monitor (funding rate crosses threshold), dca (recurring buy reminder — needs approval to execute), rebalance, custom. Notifications land in the strategy history.',
  category: 'autopilot',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Strategy name, e.g. "BTC funding alert".' },
      description: { type: 'string', description: 'What the strategy watches and does.' },
      kind: { type: 'string', description: 'alert | funding-monitor | dca | rebalance | custom.' },
      intervalMs: { type: 'number', description: 'Run every N ms (min 5000). Default 60000.' },
      symbol: { type: 'string', description: 'Symbol to watch, e.g. BTC, ETH, SOL.' },
      params: { type: 'object', description: 'Thresholds: {priceAbove, priceBelow, fundingThresholdPct, amountUsd, ...}.' },
    },
    required: ['name', 'kind'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const engine = ensureStarted();
    const strategy = engine.register({
      name: args.name,
      description: args.description ?? args.name,
      kind: args.kind,
      intervalMs: Math.max(args.intervalMs ?? 60_000, 1000),
      symbol: args.symbol,
      params: args.params ?? {},
    });
    return { real: true, registered: true, message: `Strategy "${strategy.name}" is now live; first run on next tick.`, strategy: strategySummary(strategy) };
  },
});

export const autopilotListTool: HarnessTool = defineTool({
  name: 'autopilot_list',
  description: 'List all registered autopilot strategies with status, run count, and recent run history (including notifications fired).',
  category: 'autopilot',
  parameters: { type: 'object', properties: {} },
  async execute() {
    const engine = ensureStarted();
    const all = engine.list();
    return { real: true, count: all.length, strategies: all.map(strategySummary) };
  },
});

export const autopilotPauseTool: HarnessTool = defineTool({
  name: 'autopilot_pause',
  description: 'Pause a running strategy (stops scheduled runs but keeps history).',
  category: 'autopilot',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Strategy id from autopilot_list/register.' } },
    required: ['id'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const engine = ensureStarted();
    const s = engine.setStatus(args.id, 'paused');
    if (!s) return { error: { kind: 'not_found', message: `No strategy "${args.id}".` } };
    return { real: true, paused: true, strategy: strategySummary(s) };
  },
});

export const autopilotResumeTool: HarnessTool = defineTool({
  name: 'autopilot_resume',
  description: 'Resume a paused strategy.',
  category: 'autopilot',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Strategy id.' } },
    required: ['id'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const engine = ensureStarted();
    const s = engine.setStatus(args.id, 'active');
    if (!s) return { error: { kind: 'not_found', message: `No strategy "${args.id}".` } };
    return { real: true, resumed: true, strategy: strategySummary(s) };
  },
});

export const autopilotRunNowTool: HarnessTool = defineTool({
  name: 'autopilot_run_now',
  description: 'Trigger one immediate run of a strategy (outside its schedule) and return the run result.',
  category: 'autopilot',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Strategy id.' } },
    required: ['id'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const engine = ensureStarted();
    const run = await engine.runStrategy(args.id);
    if (!run) return { error: { kind: 'not_found', message: `No strategy "${args.id}".` } };
    return { real: true, run };
  },
});

export const autopilotCloseTool: HarnessTool = defineTool({
  name: 'autopilot_close',
  description: 'Close a strategy permanently (stops runs, marks closed; history preserved).',
  category: 'autopilot',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Strategy id.' } },
    required: ['id'],
  },
  async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
    const args = params as any;
    const engine = ensureStarted();
    const s = engine.setStatus(args.id, 'closed');
    if (!s) return { error: { kind: 'not_found', message: `No strategy "${args.id}".` } };
    return { real: true, closed: true, strategy: strategySummary(s) };
  },
});

export const autopilotTools: HarnessTool[] = [
  autopilotRegisterTool,
  autopilotListTool,
  autopilotPauseTool,
  autopilotResumeTool,
  autopilotRunNowTool,
  autopilotCloseTool,
];
