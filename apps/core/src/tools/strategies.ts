/**
 * tools/strategies.ts — LLM-callable tools for the strategy workflow.
 *
 * - strategy_list            → catalog of available strategies under skills/strategies/
 * - strategy_get             → load one strategy (source + params + smoke test)
 * - strategy_save_draft      → write strategy.ts + SKILL.md to skills/strategies/<name>/
 *                             (requires approval, like other file mutations)
 * - strategy_backtest        → run a backtest asynchronously, persist the run
 * - strategy_backtest_history → query past runs for parameter reasoning
 * - strategy_backtest_get    → fetch a specific past run's detail
 *
 * `strategy_backtest` is async: it kicks off the job, returns an id right away,
 * and emits progress events over the existing event hub. Chat callers should
 * follow up with `strategy_backtest_get` to read the final metrics — or watch
 * the `strategy-backtest-end` ChatEvent.
 */

import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineTool, fetchJson, type HarnessTool } from './registry.js';
import { getStrategyByName, scanStrategies, loadStrategy } from '../strategy/loader.js';
import { runBacktest, type BacktestResult } from '../strategy/runner.js';
import {
  saveBacktestRun,
  listBacktestRuns,
  readBacktestRun,
  type BacktestRunSummary,
} from '../strategy/store.js';
import { toolContext } from '../runtime/toolContext.js';
import { findStrategyDirectory, userStrategiesRoot, validStrategyName } from '../strategy/files.js';
import { hyperliquidCandles } from '../markets/hyperliquidCandles.js';
import type { BacktestMarket, BacktestVenue, Candle, ParamValues, Timeframe } from '../strategy/types.js';

const BINANCE_SPOT = 'https://api.binance.com/api/v3';
const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '6h': 21_600_000,
  '8h': 28_800_000, '12h': 43_200_000, '1d': 86_400_000, '3d': 259_200_000,
  '1w': 604_800_000, '1M': 2_592_000_000,
};

interface ActiveJob {
  id: string;
  strategyName: string;
  venue: BacktestVenue;
  symbol: string;
  interval: Timeframe;
  startedAt: number;
  status: 'running' | 'completed' | 'failed';
  progress: number; // 0..1
  summaryId?: string;
  error?: string;
}

const jobs = new Map<string, ActiveJob>();

type ProgressListener = (job: ActiveJob, result?: BacktestResult) => void;
let progressListener: ProgressListener | null = null;
export function setStrategyProgressListener(fn: ProgressListener): void {
  progressListener = fn;
}

/** Fetch closed candles from the selected venue; never substitute a different market. */
async function fetchCandles(opts: {
  venue: BacktestVenue;
  endTime: number;
  symbol: string;
  interval: Timeframe;
  days: number;
  signal?: AbortSignal;
}): Promise<Candle[]> {
  const { venue, symbol, interval, days, signal, endTime } = opts;
  const startTime = endTime - days * 86_400_000;
  const intervalMs = TIMEFRAME_MS[interval];
  const needBars = Math.ceil((days * 86_400_000) / intervalMs);
  const maxPerReq = 1000;
  const out: Candle[] = [];
  if (venue === 'hyperliquid') {
    const rows = await hyperliquidCandles({ coin: symbol, interval, startTime: Math.floor(startTime), endTime, signal });
    const candles = [...new Map(rows
      .filter((r) => r.time >= startTime && r.closeTime < endTime)
      .map(({ closeTime: _closeTime, ...c }) => [c.time, c] as const)).values()]
      .sort((a, b) => a.time - b.time);
    if (!candles.length) throw new Error(`No closed Hyperliquid candles for ${symbol}. Use the exact coin from market_search (BTC, kPEPE, xyz:NVDA), not a Binance pair.`);
    // Detect a truncated/listing-limited window instead of silently reporting
    // the shorter result as the requested history. Allow one interval to align.
    const alignmentMs = interval === '1M' ? 31 * 86_400_000 : intervalMs;
    if (candles[0].time > startTime + alignmentMs) {
      throw new Error(`Hyperliquid history for ${symbol} begins at ${new Date(candles[0].time).toISOString()}, after the requested start. Retry with a shorter window; no backtest was saved.`);
    }
    return candles;
  }
  let cursor = startTime;
  while (out.length < needBars) {
    const limit = Math.min(maxPerReq, needBars - out.length + 100);
    const url =
      `${BINANCE_SPOT}/klines?symbol=${encodeURIComponent(symbol.toUpperCase())}` +
      `&interval=${encodeURIComponent(interval)}&limit=${limit}` +
      `&startTime=${Math.floor(cursor)}&endTime=${Math.floor(endTime)}`;
    const r = await fetchJson(url, { signal, timeoutMs: 30_000 });
    if (!r.ok) {
      const msg = (r as { error?: { error?: Record<string, unknown> } }).error?.error;
      throw new Error(`binance klines failed: ${JSON.stringify(msg)?.slice(0, 200)}`);
    }
    const rows = r.data as unknown[][];
    if (!rows.length) break;
    for (const k of rows) {
      // Binance includes the currently forming candle. Strategies only see
      // candles that had closed when this job captured its history window.
      if (Number(k[6]) >= endTime) continue;
      out.push({
        time: Number(k[0]),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
      });
    }
    const lastTime = Number(rows[rows.length - 1][0]);
    if (lastTime <= cursor) break;
    cursor = lastTime + intervalMs;
    signal?.throwIfAborted();
    if (rows.length < 2) break;
  }
  const seen = new Set<number>();
  return out
    .sort((a, b) => a.time - b.time)
    .filter((c) => (seen.has(c.time) ? false : (seen.add(c.time), true)));
}

async function runBacktestJob(job: ActiveJob, args: {
  symbol: string;
  interval: Timeframe;
  days: number;
  initialCash: number;
  feeBps?: number;
  slippageBps?: number;
  params?: Partial<ParamValues>;
  strategyDir?: string;
  signal?: AbortSignal;
}): Promise<void> {
  try {
    const signal = args.signal ?? toolContext.getStore()?.signal;
    const loaded = await getStrategyByName(job.strategyName, args.strategyDir);
    if (!loaded || loaded.problems.length) {
      throw new Error(`strategy load failed: ${loaded?.problems.join('; ') || 'not found'}`);
    }
    const endTime = Date.now();
    const market: BacktestMarket = {
      venue: job.venue, symbol: args.symbol, kind: job.venue === 'hyperliquid' ? 'perpetual' : 'spot',
      requestedRange: { from: endTime - args.days * 86_400_000, to: endTime },
      feeBps: args.feeBps ?? 5, slippageBps: args.slippageBps ?? 5,
      simulation: 'ohlcv', fundingIncluded: false, liquidationIncluded: false,
    };
    const candles = await fetchCandles({ venue: job.venue, endTime, symbol: args.symbol, interval: args.interval, days: args.days, signal });
    if (candles.length < 50) throw new Error(`only ${candles.length} candles fetched; widen the window`);

    const result = await runBacktest({
      strategy: loaded.strategy,
      candles,
      timeframe: args.interval,
      initialCash: args.initialCash,
      feeBps: args.feeBps,
      slippageBps: args.slippageBps,
      params: args.params,
      onProgress: (done, total) => {
        job.progress = done / total;
        progressListener?.(job);
      },
    });

    result.market = market;
    const summary = await saveBacktestRun({
      market,
      strategyName: job.strategyName,
      symbol: args.symbol,
      interval: args.interval,
      params: result.params,
      initialCash: result.initialCash,
      finalEquity: result.finalEquity,
      candles: result.candles,
      metrics: result.metrics,
      startedAt: job.startedAt,
      endedAt: Date.now(),
    }, result);

    job.status = 'completed';
    job.summaryId = summary.id;
    job.progress = 1;
    progressListener?.(job, result);
  } catch (e) {
    job.status = 'failed';
    job.error = e instanceof Error ? e.message : String(e);
    progressListener?.(job);
  }
}

function validName(s: unknown): s is string {
  return validStrategyName(s);
}

export const strategyListTool: HarnessTool = defineTool({
  name: 'strategy_list',
  description:
    'List the trading strategies available under the strategies skill root. Each has strategy.ts (pure TypeScript) plus SKILL.md.',
  category: 'strategies',
  parameters: { type: 'object', properties: {} },
  async execute() {
    const entries = await scanStrategies();
    return {
      count: entries.length,
      strategies: entries.map((e) => ({
        name: e.name,
        description: e.description,
        valid: e.problems.length === 0,
        problems: e.problems.length ? e.problems : undefined,
      })),
    };
  },
});

export const strategyGetTool: HarnessTool = defineTool({
  name: 'strategy_get',
  description:
    'Load one strategy by name. Returns the strategy.ts source, SKILL.md doc, declared params and a smoke-test verdict.',
  category: 'strategies',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Strategy directory name, e.g. "ma-trail-stop"' } },
    required: ['name'],
  },
  async execute(_id, params) {
    const { name } = params as { name: string };
    if (!validName(name)) throw new Error('Invalid strategy name');
    const dir = await findStrategyDirectory(name);
    if (!dir) throw new Error(`Strategy "${name}" not found`);
    const loaded = await loadStrategy(dir);
    if (!existsSync(loaded.sourcePath)) throw new Error(`Strategy "${name}" not found`);
    const source = await readFile(loaded.sourcePath, 'utf8');
    return {
      name,
      description: loaded.strategy?.description,
      valid: loaded.problems.length === 0,
      problems: loaded.problems.length ? loaded.problems : undefined,
      params: loaded.strategy?.params,
      timeframe: loaded.strategy?.timeframe,
      source,
      skillDoc: loaded.skillDoc,
    };
  },
});

export const strategySaveDraftTool: HarnessTool = defineTool({
  name: 'strategy_save_draft', approval: 'ask',
  description:
    'Save a new strategy in persistent app data under skills/strategies/<name>/. Import Strategy types and indicator helpers from "@seris/strategy". Writes strategy.ts and SKILL.md, then validates by compiling and smoke-running it. The user reviews the diff in the approval card before any file is written.',
  category: 'strategies',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Kebab-case strategy id, e.g. "ma-trail-stop-v2". Must not already exist.' },
      description: { type: 'string', description: 'One-line doc for the skill catalog.' },
      source: { type: 'string', description: 'Full contents of strategy.ts (a pure TypeScript module exporting `strategy`).' },
      skillDoc: { type: 'string', description: 'Full contents of SKILL.md (markdown).' },
    },
    required: ['name', 'source'],
  },
  async execute(_id, params) {
    const args = params as { name: string; description?: string; source: string; skillDoc?: string };
    if (!validName(args.name)) throw new Error('Invalid strategy name');
    if (typeof args.source !== 'string' || args.source.length < 100) {
      throw new Error('strategy.ts source must be a non-trivial TypeScript module');
    }
    const dir = join(userStrategiesRoot(), args.name);
    if (await findStrategyDirectory(args.name) || existsSync(dir)) throw new Error(`Strategy "${args.name}" already exists`);
    await mkdir(userStrategiesRoot(), { recursive: true });
    await mkdir(dir);
    await writeFile(join(dir, 'strategy.ts'), args.source, 'utf8');
    const doc =
      args.skillDoc ??
      `---\nname: ${args.name}\ndescription: ${JSON.stringify(args.description ?? args.name)}\nmetadata:\n  seris:\n    priority: 50\n    tool_names: [strategy_backtest, strategy_backtest_history]\n---\n\n# ${args.name}\n\n${args.description ?? ''}\n`;
    await writeFile(join(dir, 'SKILL.md'), doc, 'utf8');
    const loaded = await loadStrategy(dir);
    return {
      saved: loaded.problems.length === 0,
      name: args.name,
      dir,
      valid: loaded.problems.length === 0,
      problems: loaded.problems.length ? loaded.problems : undefined,
      hint: loaded.problems.length
        ? 'Files written, but smoke test failed. Read the problems, edit strategy.ts, then call strategy_get to re-validate.'
        : 'Strategy is ready to backtest.',
    };
  },
});

export const strategyBacktestTool: HarnessTool = defineTool({
  name: 'strategy_backtest',
  description:
    'Run an OHLCV price backtest on Binance spot or Hyperliquid perpetuals (including HIP-3 coins such as xyz:NVDA). Select venue explicitly for Hyperliquid; never substitute Binance. Funding, leverage and liquidation are not simulated. Hyperliquid provides only the latest 5000 candles and no 6h interval. Asynchronous — returns a job id immediately; poll strategy_backtest_history or wait for the strategy-backtest-end event. Results persist to the local backtests store.',
  category: 'strategies',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Strategy directory name' },
      venue: { type: 'string', enum: ['binance', 'hyperliquid'], description: 'Data venue. Defaults to binance for existing callers. Set hyperliquid for Hyperliquid/xyz perpetuals.' },
      symbol: { type: 'string', description: 'Binance: BTCUSDT. Hyperliquid: exact case-sensitive coin from market_search, e.g. BTC, ETH, kPEPE, xyz:NVDA.' },
      interval: { type: 'string', enum: Object.keys(TIMEFRAME_MS), description: 'Candle timeframe; defaults to the strategy\'s declared timeframe.' },
      days: { type: 'number', description: 'How many days of history to fetch. Default 90. Hyperliquid: keep within 5000 recent candles (e.g. 14 days at 1h or 5m); excessive windows fail without truncation.' },
      initialCash: { type: 'number', description: 'Starting cash in quote currency. Default 10,000.' },
      feeBps: { type: 'number', description: 'Taker fee in bps. Default 5.' },
      slippageBps: { type: 'number', description: 'Slippage in bps against the trader. Default 5.' },
      params: { type: 'object', additionalProperties: { type: ['number', 'boolean', 'string'] }, description: 'Param overrides (JSON object keyed by name from the strategy\'s params declaration).' },
    },
    required: ['name', 'symbol'],
  },
  async execute(_id, params, signal) {
    const args = params as {
      name: string;
      venue?: BacktestVenue;
      symbol: string;
      interval?: Timeframe;
      days?: number;
      initialCash?: number;
      feeBps?: number;
      slippageBps?: number;
      params?: Partial<ParamValues>;
    };
    if (!validName(args.name)) throw new Error('Invalid strategy name');
    const venue = args.venue ?? 'binance';
    if (venue !== 'binance' && venue !== 'hyperliquid') throw new Error('Unsupported backtest venue');
    const symbolPattern = venue === 'binance' ? /^[A-Z0-9]{2,20}$/i : /^(?:[a-z][a-z0-9-]*:)?[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
    if (typeof args.symbol !== 'string' || !symbolPattern.test(args.symbol)) {
      throw new Error('Invalid symbol: use BTCUSDT for Binance, BTC or xyz:NVDA for Hyperliquid');
    }
    const symbol = venue === 'binance' ? args.symbol.toUpperCase() : args.symbol;
    const days = args.days ?? 90;
    const initialCash = args.initialCash ?? 10_000;
    if (!Number.isFinite(days) || days <= 0 || !Number.isFinite(initialCash) || initialCash <= 0) {
      throw new Error('days and initialCash must be finite positive numbers');
    }
    for (const cost of [args.feeBps, args.slippageBps]) {
      if (cost !== undefined && (!Number.isFinite(cost) || cost < 0 || cost >= 10_000)) {
        throw new Error('feeBps and slippageBps must be between 0 (inclusive) and 10000 (exclusive)');
      }
    }
    const loadedHead = await getStrategyByName(args.name);
    if (!loadedHead || loadedHead.problems.length) {
      throw new Error(`Strategy "${args.name}" failed to load: ${loadedHead?.problems.join('; ') ?? 'not found'}`);
    }
    const interval = args.interval ?? loadedHead.strategy.timeframe;
    if (!Object.hasOwn(TIMEFRAME_MS, interval)) throw new Error(`Unsupported interval ${interval}`);
    if (venue === 'hyperliquid') {
      if (interval === '6h') throw new Error('Hyperliquid does not provide 6h candles. Choose 4h or 8h.');
      // Reserve room for the boundary and forming candle. Months vary in length.
      const minIntervalMs = interval === '1M' ? 28 * 86_400_000 : TIMEFRAME_MS[interval];
      if (Math.ceil(days * 86_400_000 / minIntervalMs) + 2 > 5000) {
        throw new Error(`Hyperliquid only provides the latest 5000 candles. For ${interval}, use at most ${(4998 * minIntervalMs / 86_400_000).toFixed(2)} days or choose a larger interval. No history was truncated.`);
      }
    }
    const job: ActiveJob = {
      id: `jb_${randomUUID().slice(0, 8)}`,
      strategyName: args.name,
      venue,
      symbol,
      interval,
      startedAt: Date.now(),
      status: 'running',
      progress: 0,
    };
    jobs.set(job.id, job);
    // Fire and forget; the runtime abort signal cancels via fetch/loop checks.
    void runBacktestJob(job, {
      symbol,
      interval,
      days,
      initialCash,
      feeBps: args.feeBps,
      slippageBps: args.slippageBps,
      params: args.params,
      signal,
    });
    return {
      jobId: job.id,
      status: job.status,
      strategyName: job.strategyName,
      venue: job.venue,
      symbol: job.symbol,
      interval: job.interval,
      hint: 'Poll strategy_backtest_history after a few seconds, or call strategy_backtest_get with the run id once it appears.',
    };
  },
});

export const strategyBacktestHistoryTool: HarnessTool = defineTool({
  name: 'strategy_backtest_history',
  description:
    'List past backtest runs and in-process job status/errors, newest first. Filter by strategy name and/or symbol. Use this to reason about parameter changes from prior runs before kicking off a new one.',
  category: 'strategies',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Strategy name to filter by.' },
      symbol: { type: 'string', description: 'Symbol to filter by.' },
      venue: { type: 'string', enum: ['binance', 'hyperliquid'], description: 'Filter by data venue.' },
      jobId: { type: 'string', description: 'Check a job returned by strategy_backtest, including failures.' },
      limit: { type: 'number', description: 'Max runs to return (default 10, max 50).' },
    },
  },
  async execute(_id, params) {
    const args = params as { name?: string; symbol?: string; venue?: BacktestVenue; jobId?: string; limit?: number };
    const runs = await listBacktestRuns({
      strategyName: args.name,
      symbol: args.symbol,
      venue: args.venue,
      limit: Math.min(args.limit ?? 10, 50),
    });
    return {
      count: runs.length,
      jobs: [...jobs.values()].reverse().filter((job) =>
        (!args.jobId || job.id === args.jobId) && (!args.name || job.strategyName === args.name)
        && (!args.symbol || job.symbol.toLowerCase() === args.symbol.toLowerCase())
        && (!args.venue || job.venue === args.venue)).slice(0, Math.min(args.limit ?? 10, 50)),
      runs: runs.map((r: BacktestRunSummary) => ({
        id: r.id,
        strategyName: r.strategyName,
        symbol: r.symbol,
        venue: r.market?.venue ?? 'binance',
        market: r.market,
        interval: r.interval,
        params: r.params,
        candles: r.candles,
        metricsHash: r.metricsHash,
        dataRange: r.dataRange,
        metrics: {
          totalReturn: r.metrics.totalReturn,
          sharpe: r.metrics.sharpe,
          maxDrawdown: r.metrics.maxDrawdown,
          winRate: r.metrics.winRate,
          tradeCount: r.metrics.tradeCount,
          profitFactor: r.metrics.profitFactor,
        },
        startedAt: r.startedAt,
      })),
    };
  },
});

export const strategyBacktestGetTool: HarnessTool = defineTool({
  name: 'strategy_backtest_get',
  description:
    'Fetch the full detail of a past backtest run — fills, equity curve, metrics — by run id from strategy_backtest_history. The response includes the run\'s metricsHash and dataRange so a downstream report can cite a metric by (runId, hash) and have a verifier match.',
  category: 'strategies',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Run id from history' } },
    required: ['id'],
  },
  async execute(_id, params) {
    const { id } = params as { id: string };
    const detail = await readBacktestRun(id);
    if (!detail) throw new Error(`Backtest run "${id}" not found`);
    const summary = (await listBacktestRuns({ limit: 200 })).find((r) => r.id === id);
    return {
      id,
      strategyName: detail.strategyName,
      symbol: detail.market?.symbol ?? summary?.symbol,
      venue: detail.market?.venue ?? 'binance',
      interval: detail.timeframe,
      market: detail.market,
      params: detail.params,
      candles: detail.candles,
      metricsHash: summary?.metricsHash,
      dataRange: summary?.dataRange,
      fills: detail.fills.slice(0, 100),
      fillsTotal: detail.fills.length,
      equityTail: detail.equity.slice(-100),
      metrics: detail.metrics,
    };
  },
});

export const strategiesTools: HarnessTool[] = [
  strategyListTool,
  strategyGetTool,
  strategySaveDraftTool,
  strategyBacktestTool,
  strategyBacktestHistoryTool,
  strategyBacktestGetTool,
];
