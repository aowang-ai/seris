/**
 * strategy/store.ts — append-only JSONL store of backtest runs.
 *
 * Lives at `<dataRoot>/.data/backtests/runs.jsonl`. One row per completed
 * run after its metrics are computed. Queried by `strategy_backtest_history`
 * to feed the LLM context for parameter reasoning.
 *
 * We do NOT keep the full fills and equity curve in JSONL — those go in a
 * sibling JSON file `<runId>.json` for the UI to fetch. The JSONL is the
 * fast-scan index; the per-run JSON is the detail payload.
 */

import { mkdir, readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { dataPath } from '../runtime/paths.js';
import type { BacktestResult } from './runner.js';
import type { BacktestRunSummary, BacktestVenue } from './types.js';

export type { BacktestRunSummary } from './types.js';

function runsDir(): string {
  return dataPath('backtests');
}

function indexPath(): string {
  return join(runsDir(), 'runs.jsonl');
}

export async function saveBacktestRun(
  summary: Omit<BacktestRunSummary, 'id' | 'detailPath' | 'metricsHash' | 'dataRange'>,
  detail: BacktestResult,
): Promise<BacktestRunSummary> {
  const id = `rb_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
  const dir = runsDir();
  await mkdir(dir, { recursive: true });
  const detailPath = join(dir, `${id}.json`);
  const first = detail.candleSeries[0];
  const last = detail.candleSeries[detail.candleSeries.length - 1];
  const metricsHash = createHash('sha256')
    .update(JSON.stringify({
      s: summary.strategyName, y: summary.symbol, i: summary.interval,
      p: summary.params,
      market: summary.market,
      m: {
        totalReturn: detail.metrics.totalReturn,
        sharpe: detail.metrics.sharpe,
        maxDrawdown: detail.metrics.maxDrawdown,
        tradeCount: detail.metrics.tradeCount,
      },
      candles: detail.candles,
    }))
    .digest('hex')
    .slice(0, 12);
  const full: BacktestRunSummary = {
    ...summary,
    id,
    detailPath,
    metricsHash,
    dataRange: { from: first.time, to: last.time },
  };
  const tmp = `${detailPath}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(detail), 'utf8');
  await rename(tmp, detailPath);
  await appendFile(indexPath(), JSON.stringify(full) + '\n', 'utf8');
  return full;
}

export async function listBacktestRuns(filter: {
  strategyName?: string;
  symbol?: string;
  venue?: BacktestVenue;
  limit?: number;
} = {}): Promise<BacktestRunSummary[]> {
  const file = indexPath();
  if (!existsSync(file)) return [];
  const text = await readFile(file, 'utf8');
  const lines = text.split('\n').filter(Boolean);
  const out: BacktestRunSummary[] = [];
  // Walk newest-first
  for (let i = lines.length - 1; i >= 0 && out.length < (filter.limit ?? 50); i--) {
    try {
      const row = JSON.parse(lines[i]) as BacktestRunSummary;
      if (filter.strategyName && row.strategyName !== filter.strategyName) continue;
      if (filter.symbol && row.symbol.toLowerCase() !== filter.symbol.toLowerCase()) continue;
      if (filter.venue && (row.market?.venue ?? 'binance') !== filter.venue) continue;
      out.push(row);
    } catch { /* skip malformed */ }
  }
  return out;
}

export async function readBacktestRun(id: string): Promise<BacktestResult | null> {
  if (!/^rb_[a-z0-9]+_[a-z0-9]+$/i.test(id)) return null;
  const path = join(runsDir(), `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf8')) as BacktestResult;
  } catch { return null; }
}

/** Delete runs older than `keepDays` days (simple GC). */
export async function pruneBacktestRuns(keepDays = 90): Promise<number> {
  void dirname(indexPath());
  // light-touch GC kept for later; current usage is small enough to skip
  void keepDays;
  return 0;
}
