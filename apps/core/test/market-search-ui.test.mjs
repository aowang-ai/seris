import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startGateway } from '../dist/gateway/server.js';
import { marketsFixture, until } from './markets-fixture.mjs';

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
