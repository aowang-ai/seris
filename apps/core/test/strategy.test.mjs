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
import { strategyBacktestTool, strategyBacktestHistoryTool, strategyBacktestGetTool, setStrategyProgressListener } from '../dist/tools/strategies.js';
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


test('Hyperliquid backtests preserve venue and HIP-3 coin, exclude open bars and expose failures', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'seris-hl-candles-'));
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
  const rows = Array.from({ length: 61 }, (_, i) => ({
    t: currentOpen - (60 - i) * hour, T: currentOpen - (59 - i) * hour - 1,
    s: 'xyz:NVDA', i: '1h', o: '100', h: '101', l: '99', c: '100', v: '1000',
  }));
  let mode = 'success';
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests++;
    assert.equal(new URL(url).hostname, 'api.hyperliquid.xyz');
    const body = JSON.parse(init.body);
    assert.equal(body.type, 'candleSnapshot');
    assert.equal(body.req.coin, 'xyz:NVDA');
    assert.equal(body.req.interval, '1h');
    assert.ok(body.req.startTime > 1e12, 'request timestamps are milliseconds');
    if (mode === 'empty') return Response.json([]);
    if (mode === 'truncated') return Response.json(rows.slice(30));
    if (mode === 'wrong-market') return Response.json([{ ...rows[0], s: 'BTC' }]);
    return Response.json([...rows, rows[0]].reverse());
  });
  const args = { name: 'ma-trail-stop', venue: 'hyperliquid', symbol: 'xyz:NVDA', interval: '1h', days: 61 / 24 };
  async function job() {
    let finish;
    const completed = new Promise((resolve) => { finish = resolve; });
    setStrategyProgressListener((j) => { if (j.status !== 'running') finish(j); });
    const launch = (await strategyBacktestTool.execute('hl', args)).details;
    const done = await completed;
    assert.equal(done.id, launch.jobId);
    return done;
  }
  const done = await job();
  assert.equal(done.status, 'completed', done.error);
  const detail = await readBacktestRun(done.summaryId);
  assert.equal(detail.candles, 60);
  assert.equal(detail.candleSeries.at(-1).time, currentOpen - hour);
  assert.equal(detail.market.venue, 'hyperliquid');
  assert.equal(detail.market.symbol, 'xyz:NVDA');
  assert.equal(detail.market.fundingIncluded, false);
  const history = (await strategyBacktestHistoryTool.execute('history', { venue: 'hyperliquid', symbol: 'xyz:NVDA' })).details;
  assert.equal(history.runs.length, 1);
  assert.equal(history.runs[0].market.venue, 'hyperliquid');
  const fetched = (await strategyBacktestGetTool.execute('get', { id: done.summaryId })).details;
  assert.equal(fetched.symbol, 'xyz:NVDA');
  assert.deepEqual(fetched.market, detail.market);
  assert.equal((await strategyBacktestHistoryTool.execute('other', { venue: 'binance' })).details.runs.length, 0);
  const count = requests;
  await assert.rejects(strategyBacktestTool.execute('limit', { ...args, days: 300 }), /5000/);
  await assert.rejects(strategyBacktestTool.execute('interval', { ...args, interval: '6h' }), /6h/);
  assert.equal(requests, count, 'unsupported requests fail before data fetch');
  for (const failure of ['empty', 'truncated', 'wrong-market']) {
    mode = failure;
    const failed = await job();
    assert.equal(failed.status, 'failed');
    const status = (await strategyBacktestHistoryTool.execute('status', { jobId: failed.id })).details;
    assert.equal(status.jobs[0].error, failed.error);
    assert.equal(status.runs.length, 1, 'failed fetch never saves a partial run or substitutes Binance');
  }
});

test('short round trips count wins/losses and both fees, including forced exits', async () => {
  for (const exitPrice of [80, 120]) {
    const result = await runBacktest({
      ...options, feeBps: 10,
      strategy: strategy((_candles, ctx) => ctx.barIndex === 0
        ? { kind: 'enter-short', notional: 500, reason: 'short' } : { kind: 'hold' }),
      candles: [bar(0, 100), bar(1, 100), bar(2, exitPrice)],
    });
    const pnl = 500 - 5 * exitPrice - 0.5 - 5 * exitPrice * 0.001;
    assert.ok(Math.abs(result.finalEquity - (1000 + pnl)) < 1e-8);
    assert.equal(result.metrics.tradeCount, 1);
    assert.equal(result.metrics.winningTrades, exitPrice === 80 ? 1 : 0);
    assert.equal(result.metrics.losingTrades, exitPrice === 120 ? 1 : 0);
    assert.ok(Math.abs((pnl > 0 ? result.metrics.avgWin : -result.metrics.avgLoss) - pnl) < 1e-8);
  }
});
