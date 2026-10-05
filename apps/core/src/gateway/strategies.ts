/**
 * gateway/strategies.ts — HTTP routes the UI calls to list strategies,
 * list backtest runs, and fetch a run's detail for the BacktestChart.
 *
 * Mirrors the marketRoute pattern: one handler, thin dispatch over the same
 * business services the agent tools use.
 */

import { readFile } from 'node:fs/promises';
import { findStrategyDirectory } from '../strategy/files.js';
import { scanStrategies, loadStrategy } from '../strategy/loader.js';
import { listBacktestRuns, readBacktestRun } from '../strategy/store.js';

export async function strategyRoute(
  path: string,
  method: string,
  url: URL,
  body: () => Promise<unknown>,
): Promise<unknown | undefined> {
  if (!path.startsWith('/api/strategies/')) return undefined;

  if (path === '/api/strategies/list' && method === 'GET') {
    const entries = await scanStrategies();
    return {
      strategies: entries.map((e) => ({
        name: e.name,
        description: e.description,
        valid: e.problems.length === 0,
        problems: e.problems.length ? e.problems : undefined,
      })),
    };
  }

  if (path === '/api/strategies/get' && method === 'GET') {
    const name = url.searchParams.get('name') ?? '';
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) throw new Error('Invalid name');
    const dir = await findStrategyDirectory(name);
    if (!dir) throw new Error('Strategy not found');
    const loaded = await loadStrategy(dir);
    const source = await readFile(loaded.sourcePath, 'utf8');
    return {
      name,
      description: loaded.strategy?.description,
      timeframe: loaded.strategy?.timeframe,
      params: loaded.strategy?.params,
      valid: loaded.problems.length === 0,
      problems: loaded.problems.length ? loaded.problems : undefined,
      source,
      skillDoc: loaded.skillDoc,
    };
  }

  if (path === '/api/strategies/backtests' && method === 'GET') {
    const name = url.searchParams.get('name') ?? undefined;
    const symbol = url.searchParams.get('symbol') ?? undefined;
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 100);
    const runs = await listBacktestRuns({ strategyName: name, symbol, limit });
    return { runs };
  }

  if (path === '/api/strategies/backtests/get' && method === 'GET') {
    const id = url.searchParams.get('id') ?? '';
    const detail = await readBacktestRun(id);
    if (!detail) throw new Error('Not found');
    return detail;
  }

  // Silence unused warnings for parity with marketRoute's signature
  void method; void body;
  return undefined;
}
