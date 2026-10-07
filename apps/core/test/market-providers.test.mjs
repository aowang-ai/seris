import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicMarketProvider } from '../dist/markets/providers.js';
import { instrumentFromId } from '../dist/markets/instruments.js';

function mockApi(t, handle) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), body });
    const data = await handle(new URL(url), body);
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}
const xyz = (symbol) => instrumentFromId(`hyperliquid-xyz:xyz:${symbol}`);
const tradifi = (symbol) => instrumentFromId(`binance-tradifi:${symbol}USDT`);

test('public search classifies traditional assets, excludes delisted xyz and prioritizes Visa', async t => {
  mockApi(t, (url, body) => {
    if (url.pathname.endsWith('/exchangeInfo') && url.hostname === 'fapi.binance.com')
      return { symbols: ['VAA', 'VBB', 'VCC', 'VDD', 'VEE', 'VFF', 'VGG', 'VHH', 'V', 'XAU', 'EWY', 'USDBRL'].map(baseAsset => ({
        symbol: `${baseAsset}USDT`, baseAsset, status: 'TRADING', contractType: 'TRADIFI_PERPETUAL',
        underlyingType: baseAsset === 'XAU' ? 'COMMODITY' : baseAsset === 'USDBRL' ? 'FX' : 'EQUITY',
      })) };
    if (body?.dex === 'xyz') return { universe: ['AVGO', 'TQQQ', 'SOXL', 'GOLD', 'EUR', 'SP500', 'VIX'].map(symbol => ({
      name: `xyz:${symbol}`, maxLeverage: 10, isDelisted: symbol === 'VIX',
    })) };
    if (body?.type === 'meta') return { universe: [] };
    if (url.hostname.includes('yahoo')) return { quotes: [] };
    return { symbols: [] };
  });
  const provider = new PublicMarketProvider();
  for (const [symbol, venue, kind] of [
    ['V', 'binance-tradifi', 'stock'], ['XAU', 'binance-tradifi', 'commodity'],
    ['EWY', 'binance-tradifi', 'etf'], ['USDBRL', 'binance-tradifi', 'forex'],
    ['AVGO', 'hyperliquid-xyz', 'stock'], ['TQQQ', 'hyperliquid-xyz', 'etf'],
    ['SOXL', 'hyperliquid-xyz', 'etf'], ['GOLD', 'hyperliquid-xyz', 'commodity'],
    ['EUR', 'hyperliquid-xyz', 'forex'], ['SP500', 'hyperliquid-xyz', 'index'],
  ]) {
    const row = (await provider.search(symbol)).find(i => i.venue === venue && i.symbol === symbol);
    assert.equal(row?.kind, kind, `${venue}:${symbol}`);
  }
  assert.ok(!(await provider.search('VIX')).some(i => i.venue === 'hyperliquid-xyz'));
});

test('xyz uses mark context, preserves universe indices and rejects delisted charts', async t => {
  const calls = mockApi(t, (_url, body) => {
    assert.equal(body.type, 'metaAndAssetCtxs');
    assert.equal(body.dex, 'xyz');
    return [{ universe: [{ name: 'xyz:DXY', isDelisted: true }, { name: 'xyz:NVDA' }, { name: 'xyz:GOLD' }] }, [
      { markPx: '97' },
      { markPx: '110', midPx: '111', prevDayPx: '100', dayNtlVlm: '5000', funding: '0.0001', openInterest: '200' },
      { markPx: '3000', funding: '0' },
    ]];
  });
  const provider = new PublicMarketProvider();
  const [quote, gold] = await Promise.all([provider.quote(xyz('NVDA')), provider.quote(xyz('GOLD'))]);
  assert.equal(calls.length, 1, 'concurrent rows share one context read');
  assert.equal(quote.priceType, 'mark');
  assert.equal(quote.price, 110, 'mid price must not be labelled mark');
  assert.ok(Math.abs(quote.changePct - 10) < 1e-10);
  assert.equal(quote.volume, 5000);
  assert.equal(quote.openInterestUsd, 22000);
  assert.equal(quote.fundingHourlyPct, 0.01);
  assert.equal(gold.fundingHourlyPct, 0);
  assert.equal(gold.volume, null);
  assert.equal(gold.changePct, null);
  assert.equal(gold.openInterestUsd, undefined);
  await assert.rejects(provider.quote(xyz('DXY')), /delisted/);
  await assert.rejects(provider.candles(xyz('DXY'), '1h'), /delisted/);
  assert.equal(calls.length, 1, 'delisted market never requests candles');
});

test('xyz cannot substitute a mid or zero for an unavailable mark price', async t => {
  mockApi(t, () => [{ universe: [{ name: 'xyz:NVDA' }] }, [{ midPx: '110', markPx: null }]]);
  await assert.rejects(new PublicMarketProvider().quote(xyz('NVDA')), /Invalid xyz mark price/);
});

test('Binance funding is converted from the actual settlement interval to percentage per hour', async t => {
  const calls = mockApi(t, (url) => {
    if (url.pathname.endsWith('/fundingInfo')) return [
      { symbol: 'NVDAUSDT', fundingIntervalHours: 8 }, { symbol: 'XAUUSDT', fundingIntervalHours: 4 },
    ];
    if (url.pathname.endsWith('/premiumIndex')) return { lastFundingRate: url.searchParams.get('symbol') === 'VUSDT' ? '0' : '0.0008' };
    return { lastPrice: '110', priceChangePercent: '2', quoteVolume: '5000', closeTime: Date.now() };
  });
  const provider = new PublicMarketProvider();
  const rows = await Promise.all(['NVDA', 'XAU', 'SPY', 'V'].map(s => provider.quote(tradifi(s))));
  assert.deepEqual(rows.map(q => q.fundingHourlyPct), [0.01, 0.02, 0.01, 0]);
  assert.ok(rows.every(q => q.currency === 'USDT' && q.priceType === 'last'));
  assert.equal(calls.filter(c => c.url.endsWith('/fundingInfo')).length, 1);
});

test('an unavailable funding interval leaves funding unknown without losing or poisoning the price', async t => {
  let fail = true;
  mockApi(t, (url) => {
    if (url.pathname.endsWith('/fundingInfo')) {
      if (fail) throw new Error('offline');
      return [{ symbol: 'NVDAUSDT', fundingIntervalHours: 4 }];
    }
    if (url.pathname.endsWith('/premiumIndex')) return { lastFundingRate: '0.0008' };
    return { lastPrice: '110', closeTime: Date.now() };
  });
  const provider = new PublicMarketProvider();
  const quote = await provider.quote(tradifi('NVDA'));
  assert.equal(quote.price, 110);
  assert.equal(quote.fundingHourlyPct, undefined);
  fail = false;
  assert.equal((await provider.quote(tradifi('NVDA'))).fundingHourlyPct, 0.02);
});
