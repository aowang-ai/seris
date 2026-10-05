import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MarketService, DEFAULT_WATCHLIST } from '../dist/markets/service.js';
import { AutopilotEngine } from '../dist/autopilot/engine.js';
import { SerisRuntime } from '../dist/runtime/serisRuntime.js';
import { ToolRegistry } from '../dist/tools/registry.js';
import { createMarketsTools } from '../dist/tools/markets.js';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai';
export const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
export const answer = (content, stopReason = 'stop') => ({
  role: 'assistant',
  content,
  api: 'anthropic-messages',
  provider: 'fixture',
  model: 'fixture',
  stopReason,
  timestamp: Date.now(),
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
});
export const call = (name, args = {}, id = 'call-1') =>
  answer([{ type: 'toolCall', id, name, arguments: args }], 'toolUse');
export const until = async (fn) => {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('Condition timed out');
};
export async function marketsFixture(t, responses = []) {
  const dir = await mkdtemp(join(tmpdir(), 'seris-markets-'));
  process.env.SERIS_DATA_DIR = dir;
  const prices = new Map(
    DEFAULT_WATCHLIST.map((i) => [i.id, i.venue === 'us' ? 150 : 65000]),
  );
  const provider = {
    quotesRead: 0,
    age: 0,
    async search(query) {
      return DEFAULT_WATCHLIST.filter((i) =>
        i.symbol.includes(query.toUpperCase()),
      );
    },
    async quote(instrument) {
      this.quotesRead++;
      return {
        instrument,
        price: prices.get(instrument.id) ?? 200,
        currency: instrument.venue === 'binance' ? 'USDT' : 'USD',
        changePct: 2.5,
        volume: 10000000,
        source: 'Fixture',
        priceType: 'last',
        time: Date.now() - this.age,
        fetchedAt: Date.now(),
        changePeriod: instrument.venue === 'us' ? 'session' : '24h',
        fundingHourlyPct: 0.01,
      };
    },
    async candles(instrument, interval) {
      const seconds = {
        '15m': 900,
        '1h': 3600,
        '4h': 14400,
        '1d': 86400,
        '1w': 604800,
      }[interval];
      const end = Math.floor(Date.now() / 1000 / seconds) * seconds;
      const base = prices.get(instrument.id) ?? 200;
      return {
        source: 'Fixture',
        adjustment: 'none',
        candles: Array.from({ length: 160 }, (_, n) => ({
          time: end - (159 - n) * seconds,
          open: base * (0.9 + n / 1600),
          close: base * (0.902 + n / 1600),
          high: base * (0.906 + n / 1600),
          low: base * (0.897 + n / 1600),
          volume: 100 + n,
        })),
      };
    },
    async news() {
      return [
        {
          title: 'Fixture market news',
          url: 'https://example.com/news',
          source: 'Fixture',
          publishedAt: Date.now(),
        },
      ];
    },
    async fundamentals(instrument) {
      return {
        instrument,
        source: 'Fixture',
        company: [{ name: instrument.name }],
        valuation: [{ peTtmRatio: 20 }],
        filings: [],
      };
    },
  };
  let service;
  const engine = new AutopilotEngine({
    statePath: join(dir, '.data', 'autopilot.json'),
    observe: (s) => service.observeRule(s.params.marketRule),
  });
  service = new MarketService(
    join(dir, '.data', 'markets', 'watchlist.json'),
    provider,
    engine,
  );
  const models = {
    streamSimple() {
      const stream = new AssistantMessageEventStream();
      stream.push({
        type: 'done',
        reason: 'stop',
        message:
          responses.shift() ??
          answer([{ type: 'text', text: 'Fixture analysis complete' }]),
      });
      return stream;
    },
  };
  const tools = new ToolRegistry();
  for (const tool of createMarketsTools(() => service)) tools.register(tool);
  const deps = {
    models,
    model: {
      id: 'fixture',
      provider: 'fixture',
      api: 'anthropic-messages',
      contextWindow: 200000,
      maxTokens: 8192,
    },
    tools,
    skills: {},
    buildSystemPrompt: async () => 'Fixture',
    sessionsRoot: join(dir, 'sessions'),
    cwd: join(dir, 'workspace'),
  };
  const runtime = new SerisRuntime(deps);
  await runtime.init();
  t.after(async () => {
    engine.stop();
    await runtime.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, service, engine, provider, prices, runtime, deps, tools };
}
