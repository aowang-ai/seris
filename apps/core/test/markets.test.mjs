import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import {
  marketsFixture,
  call,
  answer,
  deferred,
  until,
} from './markets-fixture.mjs';
import { MarketService, DEFAULT_WATCHLIST } from '../dist/markets/service.js';
import { cleanCandles } from '../dist/markets/providers.js';
import {
  parseContextInput,
  parseInstrument,
  parseRule,
  isMarketAction,
} from '../dist/markets/types.js';
import { toolContext } from '../dist/runtime/toolContext.js';
import { SerisRuntime } from '../dist/runtime/serisRuntime.js';
import { startGateway } from '../dist/gateway/server.js';
const btc = DEFAULT_WATCHLIST[0],
  nvda = DEFAULT_WATCHLIST[3];
test('AI search, candles, chart actions and persistent watchlist accept both new venue IDs through pi', async t => {
  const { instrumentFromId } = await import('../dist/markets/instruments.js');
  const instruments = ['binance-tradifi:NVDAUSDT', 'hyperliquid-xyz:xyz:NVDA', 'binance-tradifi:VUSDT']
    .map(instrumentFromId);
  instruments[1].maxLeverage = 20;
  const responses = [];
  for (const [n, i] of instruments.entries()) responses.push(
    call('market_search', { query: i.symbol }, `search-${n}`),
    call('get_market_candles', { instrumentId: i.id, interval: '1h' }, `candles-${n}`),
    call('market_watchlist', { action: 'add', instrumentId: i.id }, `watch-${n}`),
    call('market_set_view', { instrumentId: i.id, interval: '1h' }, `view-${n}`),
  );
  responses.push(answer([{ type: 'text', text: 'Ready' }]));
  const { runtime, service, provider, engine, dir } = await marketsFixture(t, responses);
  provider.search = async query => instruments.filter(i => i.symbol === query);
  const session = await runtime.createSession();
  await runtime.prompt(session.id, '搜索 NVDA 和 Visa，读取图表并加入关注');
  const history = await runtime.sessionHistory(session.id);
  for (const [n, i] of instruments.entries()) {
    const candles = JSON.parse(history.find(m => m.toolCallId === `candles-${n}`).text);
    assert.deepEqual(candles.instrument, i);
    assert.equal(candles.candles.length, 160);
    const action = history.find(m => m.toolCallId === `view-${n}`).marketAction;
    assert.deepEqual(action?.context.instrument, i);
    assert.deepEqual(service.watchlist().find(w => w.id === i.id), i);
  }
  const restored = new MarketService(join(dir, '.data', 'markets', 'watchlist.json'), provider, engine);
  assert.deepEqual(restored.watchlist(), service.watchlist());
  for (const [id, kind] of [['hyperliquid-xyz:xyz:AVGO', 'stock'], ['hyperliquid-xyz:xyz:TQQQ', 'etf'], ['binance-tradifi:XAUUSDT', 'commodity']])
    assert.equal(restored.instrument(id).kind, kind);
  for (const id of ['hyperliquid-xyz:xyz', 'binance-tradifi:USDT', 'hyperliquid-xyz:xyz:NVDA:bad'])
    assert.throws(() => restored.instrument(id), /Invalid/);
  const legacy = [...service.watchlist(), { ...instrumentFromId('hyperliquid-xyz:xyz:AVGO'), kind: 'index' }];
  await writeFile(join(dir, '.data', 'markets', 'watchlist.json'), JSON.stringify(legacy));
  const migrated = new MarketService(join(dir, '.data', 'markets', 'watchlist.json'), provider, engine);
  assert.equal(migrated.watchlist().find(i => i.symbol === 'AVGO').kind, 'stock');
});
test('frozen chart is validated, durable and independent of later prices', async (t) => {
  const { service, provider, dir, engine } = await marketsFixture(t);
  const chart = await service.chart(btc, '1h');
  const context = service.capture({
    viewId: 'btc-view',
    dataRef: chart.id,
    selectedRange: { from: chart.candles[10].time, to: chart.candles[20].time },
    instrument: nvda,
    quote: { price: 1 },
  });
  assert.equal(context.instrument.id, btc.id);
  assert.equal(context.quote.price, 65000);
  const fresh = new MarketService(
    join(dir, '.data', 'markets', 'watchlist.json'),
    provider,
    engine,
  );
  assert.deepEqual(fresh.snapshot(chart.id), chart);
  assert.deepEqual(fresh.capture(context), context);
  assert.throws(
    () => service.capture({ ...context, selectedRange: { from: 1, to: 2 } }),
    /no chart data/,
  );
  const file = join(dir, '.data', 'markets', 'snapshots', `${chart.id}.json`);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  saved.candles[0].close = 1;
  await writeFile(file, JSON.stringify(saved));
  assert.throws(() => fresh.snapshot(chart.id), /integrity/);
  assert.throws(
    () => parseContextInput({ viewId: 123, dataRef: chart.id }),
    /Invalid/,
  );
  assert.throws(
    () =>
      parseContextInput({ ...context, selectedRange: { from: NaN, to: 1 } }),
    /Invalid/,
  );
  assert.throws(() => parseInstrument({ ...btc, id: 'us:BTC.US' }), /Invalid/);
  assert.throws(
    () =>
      parseRule({
        instrument: nvda,
        metric: 'fundingHourlyPct',
        direction: 'above',
        threshold: 1,
      }),
    /Funding/,
  );
});
test('price reads are cached and concurrent charts share one snapshot', async (t) => {
  const { service, provider } = await marketsFixture(t);
  const [a, b] = await Promise.all([
    service.chart(btc, '1d'),
    service.chart(btc, '1d'),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(provider.quotesRead, 1);
  a.quote.price = 1;
  assert.equal((await service.chart(btc, '1d')).quote.price, 65000);
  const valid = { time: 1, open: 10, close: 11, high: 12, low: 9, volume: 2 };
  assert.deepEqual(
    cleanCandles([
      { ...valid, time: 2 },
      valid,
      { ...valid, high: 5 },
      { ...valid, time: NaN },
      valid,
    ]),
    [valid, { ...valid, time: 2 }],
  );
});
test('Markets run preserves its snapshot and persists typed view actions through pi', async (t) => {
  const { runtime, service, tools, deps } = await marketsFixture(t, [
    call('get_market_context'),
    // pi serializes this batch because it contains a context-changing tool.
    answer(
      [
        {
          type: 'toolCall',
          id: 'view-call',
          name: 'market_set_view',
          arguments: { instrumentId: nvda.id, interval: '1d' },
        },
        {
          type: 'toolCall',
          id: 'new-context',
          name: 'get_market_context',
          arguments: {},
        },
      ],
      'toolUse',
    ),
    answer([{ type: 'text', text: 'Done' }]),
  ]);
  const original = service.capture({
    viewId: 'btc-original',
    dataRef: (await service.chart(btc, '1h')).id,
  });
  const expected = JSON.parse(JSON.stringify(original));
  const session = await runtime.createSession();
  const events = [];
  runtime.onEvent((e) => events.push(e));
  const run = runtime.startPrompt(session.id, '换成 NVDA 日线再分析', {
    requestId: 'market-run-001',
    marketContext: original,
  });
  original.instrument = nvda;
  original.quote.price = 1;
  await run.done;
  assert.equal(runtime.runState(session.id).status, 'completed');
  const history = await runtime.sessionHistory(session.id);
  assert.deepEqual(history[0].marketContext, expected);
  assert.equal(history[0].text, '换成 NVDA 日线再分析');
  const read = JSON.parse(history.find((m) => m.toolCallId === 'call-1').text);
  assert.equal(read.context.instrument.id, btc.id);
  const action = history.find((m) => m.toolCallId === 'view-call').marketAction;
  assert.ok(action);
  assert.equal(action.originViewId, 'btc-original');
  assert.equal(action.context.instrument.id, nvda.id);
  const next = JSON.parse(
    history.find((m) => m.toolCallId === 'new-context').text,
  );
  assert.equal(next.context.dataRef, action.context.dataRef);
  assert.ok(events.some((e) => e.message?.marketAction?.id === action.id));
  await runtime.prompt(session.id, '换成 NVDA 日线再分析', {
    requestId: 'market-run-001',
    marketContext: expected,
  });
  assert.throws(
    () =>
      runtime.startPrompt(session.id, '换成 NVDA 日线再分析', {
        requestId: 'market-run-001',
        marketContext: action.context,
      }),
    /different prompt/,
  );
  const restored = new SerisRuntime(deps);
  await restored.init();
  t.after(() => restored.dispose());
  assert.deepEqual(await restored.sessionHistory(session.id), history);
  const outside = tools.get('get_market_context');
  await assert.rejects(outside.execute('no-context', {}), /No Markets/);
  const frozenCandles = await toolContext.run(
    { sessionId: session.id, workspace: deps.cwd, marketContext: expected },
    () => tools.get('get_market_candles').execute('candles', {}),
  );
  assert.equal(frozenCandles.details.dataRef, expected.dataRef);
});
test('ordinary Chat can open a chart without an attached Markets context', async (t) => {
  const { runtime, service } = await marketsFixture(t, [
    call('market_set_view', { instrumentId: nvda.id, interval: '1h' }),
    call('get_market_context', {}, 'new-context'),
    answer([{ type: 'text', text: 'Chart ready' }]),
    call('market_set_view', {}, 'missing-instrument'),
    answer([{ type: 'text', text: 'Specify an instrument' }]),
  ]);
  const session = await runtime.createSession();
  await runtime.prompt(session.id, 'Show NVDA');
  const history = await runtime.sessionHistory(session.id);
  assert.equal(history[0].marketContext, undefined);
  const action = history.find(
    (m) => m.toolName === 'market_set_view',
  ).marketAction;
  assert.ok(isMarketAction(action));
  assert.equal(action.originViewId, undefined);
  assert.equal(service.snapshot(action.context.dataRef).instrument.id, nvda.id);
  assert.equal(action.context.interval, '1h');
  const next = JSON.parse(
    history.find((m) => m.toolCallId === 'new-context').text,
  );
  assert.equal(next.context.dataRef, action.context.dataRef);
  await runtime.prompt(session.id, 'Show a chart');
  const failed = (await runtime.sessionHistory(session.id)).find(
    (m) => m.toolCallId === 'missing-instrument' && m.role === 'tool',
  );
  assert.equal(failed.isError, true);
  assert.equal(
    failed.marketAction,
    undefined,
    'missing instrument cannot silently pick a market',
  );
});
test('alerts persist, cross once, and deduplicate concurrent checks', async (t) => {
  const { service, engine, dir } = await marketsFixture(t);
  let value = 90;
  let calls = 0;
  engine.observe = async () => {
    calls++;
    return { metric: value };
  };
  const rule = {
    instrument: btc,
    metric: 'price',
    direction: 'above',
    threshold: 100,
    once: false,
  };
  const alert = service.createAlert(rule, 'alert-request-001');
  assert.equal(service.createAlert(rule, 'alert-request-001').id, alert.id);
  assert.throws(
    () => service.createAlert({ ...rule, threshold: 101 }, 'alert-request-001'),
    /different/,
  );
  await engine.runStrategy(alert.id);
  value = 101;
  await Promise.all([
    engine.runStrategy(alert.id),
    engine.runStrategy(alert.id),
  ]);
  assert.equal(calls, 2);
  assert.equal(service.notifications().length, 1);
  value = 110;
  await engine.runStrategy(alert.id);
  assert.equal(service.notifications().length, 1);
  value = 99;
  await engine.runStrategy(alert.id);
  value = 105;
  await engine.runStrategy(alert.id);
  assert.equal(service.notifications().length, 2);
  const once = service.createAlert(
    { ...rule, once: true },
    'alert-request-002',
  );
  await engine.runStrategy(once.id);
  assert.equal(service.alerts().find((a) => a.id === once.id).status, 'paused');
  assert.equal(await engine.runStrategy(once.id), undefined);
  const persisted = JSON.parse(
    await readFile(join(dir, '.data', 'autopilot.json'), 'utf8'),
  );
  assert.equal(persisted.strategies[once.id].status, 'paused');
});
test('pausing a pending monitor suppresses the result and stale quotes cannot notify', async (t) => {
  const { service, engine, provider } = await marketsFixture(t);
  const wait = deferred();
  engine.observe = () => wait.promise;
  const alert = service.createAlert({
    instrument: btc,
    metric: 'price',
    direction: 'above',
    threshold: 10,
    once: true,
  });
  const pending = engine.runStrategy(alert.id);
  service.setAlert(alert.id, 'paused');
  wait.resolve({ metric: 100 });
  assert.equal(await pending, undefined);
  assert.equal(service.notifications().length, 0);
  provider.age = 3600000;
  const observation = await service.observeRule({
    instrument: nvda,
    metric: 'price',
    direction: 'above',
    threshold: 1,
    once: true,
  });
  assert.equal(observation.metric, undefined);
  assert.match(observation.monitoring, /等待/);
  await assert.rejects(
    service.observeRule({
      instrument: btc,
      metric: 'price',
      direction: 'above',
      threshold: 1,
      once: true,
    }),
    /过期/,
  );
});
test('authenticated Markets API resolves context on server and accepts old plain prompts', async (t) => {
  const { runtime, service } = await marketsFixture(t);
  const gw = await startGateway({ runtime, markets: service });
  t.after(() => gw.close());
  const headers = {
    authorization: `Bearer ${gw.token}`,
    'content-type': 'application/json',
  };
  const post = (path, body) =>
    fetch(gw.url + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  assert.equal((await fetch(gw.url + '/api/markets/state')).status, 401);
  const chart = await (
    await post('/api/markets/chart', { instrument: btc, interval: '1h' })
  ).json();
  assert.equal(chart.instrument.id, btc.id);
  const session = await runtime.createSession();
  const route = `/api/sessions/${session.id}/prompt`;
  const response = await post(route, {
    text: 'Analyze',
    requestId: 'gateway-market-001',
    marketContext: {
      viewId: 'api-btc',
      dataRef: chart.id,
      instrument: nvda,
      quote: { price: 1 },
    },
  });
  assert.equal(response.status, 202);
  await until(() => runtime.runState(session.id)?.status === 'completed');
  assert.equal(
    (await runtime.sessionHistory(session.id))[0].marketContext.instrument.id,
    btc.id,
  );
  assert.equal(
    (
      await post(route, {
        text: 'Bad range',
        requestId: 'gateway-market-002',
        marketContext: {
          viewId: 'api-btc',
          dataRef: chart.id,
          selectedRange: { from: 2, to: 1 },
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (await post(route, { text: 'Plain', requestId: 'gateway-plain-001' }))
      .status,
    202,
  );
});
