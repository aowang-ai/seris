import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startGateway } from '../dist/gateway/server.js';
import { marketsFixture, until, call, answer } from './markets-fixture.mjs';

test('market dropdown aligns nine result rows with watch controls, truncates names and scrolls/selects correctly', async t => {
  const { runtime, service, provider } = await marketsFixture(t);
  const instruments = Array.from({ length: 9 }, (_, n) => ({
    id: `binance:HYPER${n}USDT`, symbol: `HYPER${n}`, providerSymbol: `HYPER${n}USDT`,
    name: n === 1 ? 'Hyper 中文标的名称较长时保持结果行清晰 '.repeat(8) : `Hyper ${n} / USDT`, kind: 'crypto', venue: 'binance',
  }));
  provider.search = async () => instruments;
  const gateway = await startGateway({ runtime, markets: service, staticRoot: fileURLToPath(new URL('../../desktop-ui/dist/', import.meta.url)) });
  t.after(() => gateway.close());
  const browser = await chromium.launch({ headless: true, ...(process.env.SERIS_BROWSER_PATH ? { executablePath: process.env.SERIS_BROWSER_PATH } : { channel: 'chrome' }) });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1280, height: 840 } });
  await page.goto(gateway.launchUrl);
  await page.getByText('已连接', { exact: true }).waitFor();
  await page.getByRole('button', { name: '市场', exact: true }).click();
  await page.getByLabel('BTC K 线图', { exact: true }).waitFor();

  // Open the dropdown via the instrument switcher in the top info bar.
  const switcher = page.locator('.instrument-switcher');
  await switcher.waitFor();
  await switcher.click();
  const dropdown = page.locator('.market-dropdown');
  await dropdown.waitFor();

  // Switch to "All" tab so we see search results, not the watchlist.
  await dropdown.getByRole('tab', { name: '全部', exact: true }).click();

  const input = dropdown.locator('input[aria-label="搜索标的"]');
  await input.fill('Hyper');
  await until(async () => (await dropdown.locator('.dropdown-row').count()) === 9);

  for (const viewport of [{ width: 1280, height: 840 }, { width: 960, height: 640 }]) {
    await page.setViewportSize(viewport);
    const rows = await dropdown.evaluate((el) => {
      return [...el.querySelectorAll('.dropdown-row')].map((row) => {
        const box = row.getBoundingClientRect();
        const symbolCell = row.querySelector('.col-symbol');
        const strong = symbolCell?.querySelector('strong');
        const name = symbolCell?.querySelector('.row-name');
        const strongBox = strong?.getBoundingClientRect();
        const truncated = name ? name.scrollWidth > name.clientWidth : false;
        return {
          height: box.height,
          symbolAlignTop: strongBox ? Math.abs(strongBox.top - box.top) < 12 : false,
          truncated,
        };
      });
    });
    assert.equal(rows.length, 9);
    for (const row of rows) {
      assert.ok(row.height < 100 && row.height > 20, JSON.stringify(row));
      assert.equal(row.symbolAlignTop, true, JSON.stringify(row));
    }
    assert.equal(rows[1].truncated, true, `expected row 1 to truncate, got ${JSON.stringify(rows[1])}`);
  }

  // IME composition must not select a market while composing.
  await input.dispatchEvent('compositionstart', { data: '中' });
  await input.press('Enter');
  assert.equal(await dropdown.isVisible(), true, 'IME confirmation must not select or close the dropdown');
  await input.dispatchEvent('compositionend', { data: '中文' });

  // Click a row's star to add to watchlist — dropdown must stay open.
  const hyper8Row = dropdown.locator('.dropdown-row').filter({ hasText: 'HYPER8' }).first();
  await hyper8Row.locator('.row-star').click();
  await until(async () => service.watchlist().some(i => i.id === instruments[8].id));
  assert.equal(await dropdown.isVisible(), true, 'watching does not close the dropdown');

  // Click the same row to select; the dropdown closes and the chart updates.
  await hyper8Row.click();
  await page.getByLabel('HYPER8 K 线图', { exact: true }).waitFor();
});

test('empty persisted watchlist can search, select and watch a market after reload', async t => {
  const { runtime, service } = await marketsFixture(t);
  for (const i of service.watchlist()) service.remove(i.id);
  const gateway = await startGateway({ runtime, markets: service, staticRoot: fileURLToPath(new URL('../../desktop-ui/dist/', import.meta.url)) });
  t.after(() => gateway.close());
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'zh-CN' });
  await page.goto(gateway.launchUrl);
  await page.getByText('已连接', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('已连接', { exact: true }).waitFor();
  await page.getByRole('button', { name: '市场', exact: true }).click();
  await page.locator('.chart-empty').getByRole('button', { name: '搜索标的', exact: true }).click();
  const dropdown = page.locator('.market-dropdown');
  await dropdown.waitFor();
  await until(async () => await dropdown.getByRole('tab', { name: '全部', exact: true }).getAttribute('aria-selected') === 'true');
  await dropdown.getByRole('textbox', { name: '搜索标的', exact: true }).fill('BTC');
  const row = dropdown.locator('.dropdown-row').filter({ hasText: 'BTC' });
  await row.waitFor();
  await row.click();
  await page.getByLabel('BTC K 线图', { exact: true }).waitFor();
  await page.getByRole('button', { name: '关注当前标的', exact: true }).click();
  await until(() => service.watchlist().some(i => i.id === 'hyperliquid:BTC'));
  await page.reload();
  await page.getByRole('button', { name: '市场', exact: true }).click();
  await page.getByLabel('BTC K 线图', { exact: true }).waitFor();
});

test('all perpetual venues show consistent hourly funding and accurate price labels', async t => {
  const { runtime, service, provider } = await marketsFixture(t);
  const { instrumentFromId } = await import('../dist/markets/instruments.js');
  const instruments = ['hyperliquid:BTC', 'hyperliquid-xyz:xyz:GOLD', 'binance-tradifi:NVDAUSDT'].map(instrumentFromId);
  for (const i of service.watchlist()) service.remove(i.id);
  for (const i of instruments) service.add(i);
  const readQuote = provider.quote.bind(provider);
  provider.quote = async i => ({ ...(await readQuote(i)), currency: i.venue === 'binance-tradifi' ? 'USDT' : 'USD',
    priceType: i.venue === 'binance-tradifi' ? 'last' : 'mark', openInterestUsd: 1000000 });
  const gateway = await startGateway({ runtime, markets: service, staticRoot: fileURLToPath(new URL('../../desktop-ui/dist/', import.meta.url)) });
  t.after(() => gateway.close());
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 840 } });
  await page.goto(gateway.launchUrl);
  await page.getByText('已连接', { exact: true }).waitFor();
  await page.getByRole('button', { name: '市场', exact: true }).click();
  for (const i of instruments) {
    await page.locator('.instrument-switcher').click();
    const dropdown = page.locator('.market-dropdown');
    const row = dropdown.locator('.dropdown-row').filter({ hasText: i.symbol });
    await until(async () => await row.locator('.col-funding').textContent() === '+0.0100%');
    assert.equal(await row.locator('.col-oi').textContent(), '$1.00M');
    await row.click();
    await page.getByLabel(`${i.symbol} K 线图`, { exact: true }).waitFor();
    const bar = page.locator('.instrument-info-bar');
    assert.equal(await bar.locator('.info-cell').filter({ hasText: '资金费率 / 小时' }).locator('strong').textContent(), '+0.0100%');
    assert.equal(await bar.locator('.info-cell').filter({ hasText: '持仓量' }).locator('strong').textContent(), '$1.00M');
    assert.equal(await bar.locator('.info-cell small').first().textContent(), i.venue === 'binance-tradifi' ? '最新成交价' : '标记价格');
    if (i.venue === 'binance-tradifi') assert.match(await bar.locator('.info-cell strong').first().textContent(), /USDT$/);
  }
});

test('a prompt receipt opens its chart from a snapshot before SSE delivers the tool action', async t => {
  const { runtime, service } = await marketsFixture(t, [
    call('market_set_view', { instrumentId: 'us:NVDA.US', interval: '1h' }, 'snapshot-view'),
    answer([{ type: 'text', text: 'Chart loaded' }]),
  ]);
  const gateway = await startGateway({ runtime, markets: service, staticRoot: fileURLToPath(new URL('../../desktop-ui/dist/', import.meta.url)) });
  t.after(() => gateway.close());
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1280, height: 840 } });
  // Keep the stream connected but withhold all chat events. The prompt receipt
  // and snapshot are then the only way to receive this run's chart action.
  await page.addInitScript(() => {
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href).pathname === '/api/events')
        return Promise.resolve(new Response(new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"stream-ready","epoch":"fixture-stream","seq":0}\n\n'));
        } }), { headers: { 'content-type': 'text/event-stream' } }));
      return fetch(input, init);
    };
  });
  await page.route('**/api/sessions/*/prompt', async route => {
    const response = await route.fetch();
    await until(async () => runtime.runState((await runtime.listSessions())[0].id).status === 'completed');
    await route.fulfill({ response });
  });
  await page.goto(gateway.launchUrl);
  await page.getByText('已连接', { exact: true }).waitFor();
  await page.getByLabel('消息', { exact: true }).fill('打开 NVDA 小时线');
  await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
  await page.getByRole('region', { name: '市场对话', exact: true }).waitFor({ timeout: 4000 });
  await page.getByLabel('NVDA K 线图', { exact: true }).waitFor();
  assert.equal((await runtime.listSessions()).length, 1);
  await page.getByTitle('展开到完整对话').click();
  await page.reload();
  await page.getByText('已连接', { exact: true }).waitFor();
  assert.equal(await page.getByRole('region', { name: '市场对话', exact: true }).count(), 0, 'saved chart actions never replay on reload');
});
