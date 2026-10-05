import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStrategy } from '../dist/strategy/loader.js';
import { runBacktest } from '../dist/strategy/runner.js';
import { getStrategyByName } from '../dist/strategy/loader.js';
import { saveBacktestRun } from '../dist/strategy/store.js';
import { createSerisRuntime } from '../dist/runtime/createSerisRuntime.js';
import { ModelSettings } from '../dist/runtime/modelSettings.js';
import { MemorySecrets } from '../dist/runtime/credentials.js';
import { startGateway } from '../dist/gateway/server.js';
import { chromium } from 'playwright-core';
import { strategyBacktestTool, setStrategyProgressListener } from '../dist/tools/strategies.js';
import { readBacktestRun } from '../dist/strategy/store.js';

const bar = (i, price, overrides = {}) => ({
  time: 1_700_000_000_000 + i * 3_600_000,
  open: price, high: price + 1, low: price - 1, close: price, volume: 100,
  ...overrides,
});
const strategy = (onCandle) => ({
  name: 'test', timeframe: '1h', params: {}, warmup: () => 0, onCandle,
});
const options = { initialCash: 1000, feeBps: 0, slippageBps: 0 };

test('bundled strategy loads with only distribution files present', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'seris-strategy-package-'));
  try {
    const root = fileURLToPath(new URL('../', import.meta.url));
    await mkdir(join(dir, 'dist'), { recursive: true });
    await cp(join(root, 'dist/strategy'), join(dir, 'dist/strategy'), { recursive: true });
    const skillDir = join(dir, 'skills/strategies/ma-trail-stop');
    await cp(join(root, 'skills/strategies/ma-trail-stop'), skillDir, { recursive: true });
    const loaded = await loadStrategy(skillDir);
    assert.deepEqual(loaded.problems, []);
    assert.equal(loaded.strategy.name, 'ma-trail-stop');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('next-open fills do not change equity or context on the signal bar', async () => {
  const contexts = [];
  const result = await runBacktest({
    ...options,
    strategy: strategy((_candles, ctx) => {
      contexts.push({ barIndex: ctx.barIndex, cash: ctx.cash, position: ctx.position, fills: [...ctx.fills] });
      return ctx.barIndex === 0 ? { kind: 'enter-long', notional: 500, reason: 'enter' } : { kind: 'hold' };
    }),
    candles: [bar(0, 100), bar(1, 200), bar(2, 210)],
  });
  assert.equal(result.equity[0].equity, 1000);
  assert.equal(result.equity[0].cash, 1000);
  assert.equal(contexts[0].position, null);
  assert.equal(contexts[0].fills.length, 0);
  assert.equal(contexts[1].position.openedAt, bar(1, 200).time);
  assert.equal(result.fills[0].price, 200);
  assert.equal(result.fills[0].time, bar(1, 200).time);
  assert.equal(result.finalEquity, 1025);
  assert.equal(result.equity.length, 3);
  assert.equal(new Set(result.equity.map((p) => p.time)).size, 3);
  assert.equal(result.metrics.totalBars, 3);
  assert.equal(result.metrics.profitFactor, null);
});

test('exit signals execute before the next bar stop check', async () => {
  const result = await runBacktest({
    ...options,
    strategy: strategy((_candles, ctx) => ctx.barIndex === 0
      ? { kind: 'enter-long', notional: 500, stopPrice: 90, reason: 'enter' }
      : ctx.barIndex === 1 ? { kind: 'exit', reason: 'exit' } : { kind: 'hold' }),
    candles: [bar(0, 100), bar(1, 100), bar(2, 110, { low: 80 })],
  });
  assert.equal(result.fills[1].via, 'signal');
  assert.equal(result.fills[1].price, 110);
  assert.equal(result.equity[1].equity, 1000);
  assert.equal(result.finalEquity, 1050);
});

test('stops apply on the entry bar and stop trails reflect each active level', async () => {
  const result = await runBacktest({
    ...options,
    strategy: strategy((_candles, ctx) => ctx.barIndex === 0
      ? { kind: 'enter-long', notional: 500, stopPrice: 90, reason: 'enter' }
      : ctx.barIndex === 1 ? { kind: 'adjust-stop', stopPrice: 105 } : { kind: 'hold' }),
    candles: [bar(0, 100), bar(1, 110), bar(2, 110, { low: 100 })],
  });
  assert.equal(result.fills[1].via, 'stop');
  assert.equal(result.fills[1].price, 105);
  assert.deepEqual(result.stopTrail, [{ time: bar(1, 110).time, value: 90 }, { time: bar(2, 110).time, value: 105 }]);
  const immediate = await runBacktest({
    ...options,
    strategy: strategy((_candles, ctx) => ctx.barIndex === 0
      ? { kind: 'enter-long', notional: 500, stopPrice: 90, reason: 'enter' } : { kind: 'hold' }),
    candles: [bar(0, 100), bar(1, 100, { low: 80 }), bar(2, 100)],
  });
  assert.equal(immediate.fills[1].time, bar(1, 100).time);
  assert.equal(immediate.finalEquity, 950);
});

test('overridden candle interval controls the result and annualized ratios', async () => {
  const input = {
    ...options,
    strategy: strategy((_candles, ctx) => ctx.barIndex === 0
      ? { kind: 'enter-long', notional: 500, reason: 'enter' } : { kind: 'hold' }),
    candles: [bar(0, 100), bar(1, 200), bar(2, 210)],
  };
  const hourly = await runBacktest(input);
  const daily = await runBacktest({ ...input, timeframe: '1d' });
  assert.equal(daily.timeframe, '1d');
  assert.ok(Math.abs(hourly.metrics.sharpe / daily.metrics.sharpe - Math.sqrt(24)) < 1e-10);
});

test('built Strategies UI renders source, all-win metrics and both backtest charts', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'seris-strategy-ui-'));
  const previousDataDir = process.env.SERIS_DATA_DIR;
  process.env.SERIS_DATA_DIR = dir;
  t.after(async () => {
    if (previousDataDir === undefined) delete process.env.SERIS_DATA_DIR;
    else process.env.SERIS_DATA_DIR = previousDataDir;
    await rm(dir, { recursive: true, force: true });
  });
  const loaded = await getStrategyByName('ma-trail-stop');
  assert.deepEqual(loaded.problems, []);
  const candles = Array.from({ length: 360 }, (_, i) => {
    const close = 100 + 12 * Math.sin(i / 12) + i * 0.025;
    const open = 100 + 12 * Math.sin((i - 1) / 12) + i * 0.025;
    return bar(i, close, { open, high: Math.max(open, close) + 0.8, low: Math.min(open, close) - 0.8 });
  });
  const result = await runBacktest({ strategy: loaded.strategy, candles, initialCash: 10_000 });
  assert.equal(result.metrics.profitFactor, null);
  await saveBacktestRun({
    strategyName: 'ma-trail-stop', symbol: 'TESTUSDT', interval: '1h', params: result.params,
    initialCash: result.initialCash, finalEquity: result.finalEquity, candles: result.candles,
    metrics: result.metrics, startedAt: Date.now(), endedAt: Date.now(),
  }, result);
  const runtime = await createSerisRuntime({
    modelSettings: new ModelSettings(join(dir, '.data/models.json'), new MemorySecrets(), {}),
    sessionsRoot: join(dir, 'sessions'), cwd: join(dir, 'workspace'),
  });
  t.after(() => runtime.dispose());
  const gateway = await startGateway({
    runtime, staticRoot: fileURLToPath(new URL('../../desktop-ui/dist/', import.meta.url)),
  });
  t.after(() => gateway.close());
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.SERIS_BROWSER_PATH ? { executablePath: process.env.SERIS_BROWSER_PATH } : { channel: 'chrome' }),
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(gateway.launchUrl);
  await page.getByText('Model setup required', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Strategies', exact: true }).click();
  await page.getByRole('button', { name: /ma-trail-stop/ }).click();
  await page.getByRole('heading', { name: 'Parameters', exact: true }).waitFor();
  const color = await page.locator('.strategies-list .muted').evaluate((el) => getComputedStyle(el).color);
  assert.equal(color, 'rgb(115, 115, 115)');
  await page.getByRole('tab', { name: 'Strategy code', exact: true }).click();
  await page.locator('.strategies-source .shiki').first().waitFor();
  assert.match(await page.locator('.strategies-source').innerText(), /export const strategy/);
  await page.getByRole('tab', { name: 'Strategy documentation', exact: true }).click();
  await page.locator('.strategies-doc .md-h1').first().waitFor();
  await page.getByRole('tab', { name: 'Strategy overview', exact: true }).click();
  await page.getByRole('button', { name: /TESTUSDT/ }).click();
  await page.locator('.backtest-chart-equity canvas').first().waitFor();
  assert.ok(await page.locator('.backtest-chart-price canvas').count() > 0);
  assert.match(await page.locator('.run-metrics').innerText(), /Profit factor.*∞/);
  await page.getByRole('button', { name: /TESTUSDT/ }).click();
  assert.equal(await page.locator('.run-detail').count(), 1, 'selecting the current run keeps its results visible');
  assert.equal(await page.locator('.strategies-runs li .run-detail').count(), 0, 'results are outside the list rows');
  assert.deepEqual(errors, []);
});

test('backtest tool excludes the forming Binance candle from persisted results', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'seris-closed-candles-'));
  const previousDataDir = process.env.SERIS_DATA_DIR;
  process.env.SERIS_DATA_DIR = dir;
  t.after(async () => {
    setStrategyProgressListener(() => {});
    if (previousDataDir === undefined) delete process.env.SERIS_DATA_DIR;
    else process.env.SERIS_DATA_DIR = previousDataDir;
    await rm(dir, { recursive: true, force: true });
  });
  const hour = 3_600_000;
  const currentOpen = Math.floor(Date.now() / hour) * hour;
  const rows = Array.from({ length: 61 }, (_, i) => {
    const time = currentOpen - (60 - i) * hour;
    return [time, '100', '101', '99', '100', '1000', time + hour - 1];
  });
  let requests = 0;
  const mock = t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(new URL(url).hostname, 'api.binance.com');
    return Response.json(requests++ === 0 ? rows : []);
  });
  let resolveDone, rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  setStrategyProgressListener((job) => {
    if (job.status === 'completed') resolveDone(job);
    if (job.status === 'failed') rejectDone(new Error(job.error));
  });
  await strategyBacktestTool.execute('closed-candles', { name: 'ma-trail-stop', symbol: 'BTCUSDT', days: 7 });
  const job = await done;
  mock.mock.restore();
  const detail = await readBacktestRun(job.summaryId);
  assert.equal(detail.candles, 60);
  assert.equal(detail.candleSeries.at(-1).time, currentOpen - hour);
});
