/**
 * strategy/loader.ts — discover and load user-authored strategies.
 *
 * Strategies live under `<skillsRoot>/strategies/<name>/strategy.ts`, paired
 * with a `SKILL.md` in the same directory (so the agent system sees them as
 * skills too).
 *
 * The TypeScript source is loaded by esbuild at runtime: we bundle the file
 * to a single ESM chunk, write it to a temp dir under the data root, and
 * dynamic-import it. This keeps the agent free to edit strategies without
 * going through a build step.
 *
 * A strategy is validated before being returned: required fields, param
 * shape, signal shape from a dry-run onCandle. A strategy that fails
 * validation is excluded and an error is reported instead of thrown.
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { dataPath, PKG_ROOT } from '../runtime/paths.js';
import { bundledStrategiesRoot, ensureStrategyStorage, findStrategyDirectory, userStrategiesRoot, validStrategyName } from './files.js';
import type { Candle, Context, ParamSpec, ParamValues, Signal, Strategy } from './types.js';

export interface LoadedStrategy {
  strategy: Strategy;
  /** Absolute path of the source strategy.ts. */
  sourcePath: string;
  /** Absolute path of the strategy directory (skill dir). */
  dir: string;
  /** Body of SKILL.md, if present. */
  skillDoc?: string;
  /** Validation problems ("" = ok). Non-empty means the strategy was NOT returned. */
  problems: string[];
}

export interface StrategyCatalogEntry {
  name: string;
  description: string;
  dir: string;
  sourcePath: string;
  problems: string[];
}

const TIMEFRAMES = new Set(['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1M']);
const SIGNAL_KINDS = new Set(['hold', 'enter-long', 'enter-short', 'exit', 'adjust-stop', 'adjust-take-profit']);

function validateStrategy(raw: unknown, name: string): { problems: string[]; strategy?: Strategy } {
  const problems: string[] = [];
  if (typeof raw !== 'object' || raw === null) {
    return { problems: ['module did not export a strategy object'] };
  }
  const s = raw as Partial<Strategy>;
  if (typeof s.name !== 'string' || !s.name) problems.push('missing or invalid `name`');
  else if (s.name !== name) problems.push(`name "${s.name}" does not match directory "${name}"`);
  if (!TIMEFRAMES.has(s.timeframe as string)) problems.push(`invalid timeframe "${String(s.timeframe)}"`);
  if (typeof s.params !== 'object' || s.params === null) problems.push('`params` must be an object');
  if (typeof s.warmup !== 'function') problems.push('`warmup` must be a function');
  if (typeof s.onCandle !== 'function') problems.push('`onCandle` must be a function');
  if (s.params && typeof s.params === 'object') {
    for (const [k, spec] of Object.entries(s.params)) {
      const p = spec as Partial<ParamSpec>;
      if (!['int','float','boolean','string'].includes(p.type ?? '')) problems.push(`param "${k}": invalid type "${String(p.type)}"`);
      if (p.default === undefined) problems.push(`param "${k}": missing default`);
    }
  }
  if (problems.length) return { problems };
  return { problems: [], strategy: s as Strategy };
}

function validateSignal(sig: unknown): sig is Signal {
  if (typeof sig !== 'object' || sig === null) return false;
  const k = (sig as { kind?: unknown }).kind;
  return typeof k === 'string' && SIGNAL_KINDS.has(k);
}

function builtinDefaults(strategy: Strategy): ParamValues {
  const out: ParamValues = {};
  for (const [k, v] of Object.entries(strategy.params)) out[k] = v.default;
  return out;
}

/** Smoke-run onCandle with no position, no stop, one candle past warmup. */
export function smokeTestStrategy(strategy: Strategy): string[] {
  const problems: string[] = [];
  try {
    const warmup = strategy.warmup(builtinDefaults(strategy));
    if (!Number.isFinite(warmup) || warmup < 0) problems.push(`warmup() returned ${warmup}`);
    const size = Math.max(2, Math.min(Math.trunc(warmup) + 2, 100));
    const candles: Candle[] = Array.from({ length: size }, (_, i) => ({
      time: 1_700_000_000_000 + i * 3_600_000,
      open: 100 + Math.sin(i / 5) * 2,
      high: 101 + Math.sin(i / 5) * 2,
      low: 99 + Math.sin(i / 5) * 2,
      close: 100 + Math.cos(i / 5) * 2,
      volume: 1000 + i,
    }));
    const ctx: Context = { cash: 10_000, position: null, stopPrice: null, takeProfitPrice: null, fills: [], barIndex: size - 1 };
    const sig = strategy.onCandle(candles, ctx, builtinDefaults(strategy));
    if (!validateSignal(sig)) {
      problems.push(`onCandle returned invalid signal: ${JSON.stringify(sig)?.slice(0, 200)}`);
      return problems;
    }
    if (sig.kind === 'enter-long' || sig.kind === 'enter-short') {
      if (typeof sig.notional !== 'number' || !Number.isFinite(sig.notional) || sig.notional < 0) {
        problems.push(`enter signal has invalid notional: ${sig.notional}`);
      }
      if (typeof sig.reason !== 'string') problems.push('enter signal missing reason');
    }
  } catch (e) {
    problems.push(`onCandle threw: ${e instanceof Error ? e.message : String(e)}`);
  }
  return problems;
}

/** Compile a strategy.ts to a standalone .mjs with esbuild. */
async function compileStrategy(sourcePath: string, outDir: string): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const outfile = join(outDir, `${randomUUID()}.mjs`);
  await build({
    entryPoints: [sourcePath],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
    // Some strategies import from the repo source tree; resolve .ts extensions.
    loader: { '.ts': 'ts' },
    plugins: [{
      name: 'seris-strategy-sdk',
      setup(builder) {
        // Keep older drafts' relative SDK imports working after migration.
        builder.onResolve({ filter: /^@seris\/strategy(?:\/(?:types|indicators))?$|^(?:\.\.\/)+(?:dist|src)\/strategy\/(?:types|indicators)\.(?:js|ts)$/ }, args => {
          const module = args.path === '@seris/strategy' ? 'index' : args.path.match(/(types|indicators)(?:\.(?:js|ts))?$/)?.[1];
          return { path: join(PKG_ROOT, 'dist', 'strategy', `${module}.js`) };
        });
      },
    }],
  });
  return outfile;
}

/** Load a single strategy directory. Returns LoadedStrategy with problems on failure. */
export async function loadStrategy(dir: string): Promise<LoadedStrategy> {
  const sourcePath = join(dir, 'strategy.ts');
  const name = dir.replaceAll('\\', '/').split('/').pop() ?? '';
  if (!existsSync(sourcePath)) {
    return { strategy: undefined as unknown as Strategy, sourcePath, dir, problems: [`missing strategy.ts in ${dir}`] };
  }
  const tmpRoot = dataPath('strategy-cache');
  let bundle = '';
  let problems: string[] = [];
  let strategy: Strategy | undefined;
  try {
    bundle = await compileStrategy(sourcePath, tmpRoot);
    const mod = await import(pathToFileURL(bundle).href + `?v=${Date.now()}`);
    const raw = mod.strategy ?? mod.default;
    const v = validateStrategy(raw, name);
    problems = v.problems;
    strategy = v.strategy;
    if (strategy && !problems.length) {
      problems = smokeTestStrategy(strategy);
    }
  } catch (e) {
    problems = [`compile/load failed: ${e instanceof Error ? e.message : String(e)}`];
  } finally {
    if (bundle) await rm(bundle, { force: true });
  }
  let skillDoc: string | undefined;
  try {
    skillDoc = await readFile(join(dir, 'SKILL.md'), 'utf8');
  } catch { /* skill doc optional */ }
  return { strategy: strategy as Strategy, sourcePath, dir, skillDoc, problems };
}

/** Scan for strategy directories under the skills root. */
export async function scanStrategies(skillsRoot?: string): Promise<StrategyCatalogEntry[]> {
  if (!skillsRoot) await ensureStrategyStorage();
  const roots = skillsRoot ? [skillsRoot] : [userStrategiesRoot(), bundledStrategiesRoot()];
  const out: StrategyCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of await readdir(root)) {
      if (!validStrategyName(name) || seen.has(name)) continue;
      const dir = resolve(join(root, name));
      const sourcePath = join(dir, 'strategy.ts');
      if (!existsSync(sourcePath)) continue;
      seen.add(name);
      const loaded = await loadStrategy(dir);
      out.push({ name, description: loaded.strategy?.description ?? '', dir, sourcePath, problems: loaded.problems });
    }
  }
  return out;
}

/** Fetch strategy by name from the canonical strategies root. */
export async function getStrategyByName(name: string, skillsRoot?: string): Promise<LoadedStrategy | null> {
  if (!validStrategyName(name)) return null;
  const dir = skillsRoot ? join(skillsRoot, name) : await findStrategyDirectory(name);
  if (!dir || !existsSync(join(dir, 'strategy.ts'))) return null;
  return loadStrategy(dir);
}
